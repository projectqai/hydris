import type { Entity, GeoSpatialComponent } from "@projectqai/proto/world";
import { create } from "zustand";

import {
  getEntityName,
  isAsset,
  isExpired,
  isTrack,
  timestampToMs,
} from "../../../lib/api/use-track-utils";
import { worldClient } from "../../../lib/api/world-client";
import { createBackoff } from "../../../lib/backoff";
import type { ChangeSet } from "../utils/transform-entities";
import { accumulateChanges, resetDeltaState } from "../utils/transform-entities";
import { classifyEvent } from "./process-events";

const BATCH_INTERVAL_MS = 250;
const DERIVED_STATE_INTERVAL_MS = 500;

/**
 * Component filter for listEntities/watchEntities.
 * Ensures the engine emits Unobserved when a required component
 * disappears before lifetime.until (per-component GC).
 */
export const ENTITY_STREAM_FILTER = {
  or: [
    { component: [11] }, // geo: tracks, assets, sensors
    { component: [16, 17] }, // detection + bearing
    { component: [50] }, // device: config tree
    { component: [25] }, // shape: coverage, history, prediction
  ],
};

let abortController: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let derivedStateTimeout: ReturnType<typeof setTimeout> | null = null;

const previousPositions = new Map<string, { lat: number; lng: number }>();
let changeVersion = 0;

function trackPosition(id: string, geo: Entity["geo"]) {
  if (geo) {
    previousPositions.set(id, { lat: geo.latitude, lng: geo.longitude });
  }
}

function hasGeoMoved(id: string, geo: Entity["geo"]): boolean {
  if (!geo) return false;
  const prev = previousPositions.get(id);
  return !prev || prev.lat !== geo.latitude || prev.lng !== geo.longitude;
}

function isDetectionEntity(entity: Entity): boolean {
  return entity.detection != null;
}

const EMPTY_CHANGE: ChangeSet = {
  version: 0,
  updatedIds: new Set(),
  deletedIds: new Set(),
  geoChanged: false,
};

type EntityState = {
  entities: Map<string, Entity>;
  detectionEntityIds: Set<string>;
  tracks: Entity[];
  assets: Entity[];
  detections: Entity[];
  trackCount: number;
  assetCount: number;
  selfGeo: GeoSpatialComponent | null;
  hydrisVersion: string | null;
  hydrisUpdateAvailable: string | null;
  isConnected: boolean;
  error: Error | null;
  lastChange: ChangeSet;
};

type EntityActions = {
  startStream: () => void;
  stopStream: () => void;
  updateEntity: (id: string, updates: Partial<Entity>) => void;
  fetchEntity: (id: string) => Promise<Entity | null>;
  reset: () => void;
};

export const selectEntity = (id: string | null) => (state: EntityState) =>
  id ? state.entities.get(id) : undefined;

export const selectTracks = (state: EntityState) => state.tracks;
export const selectAssets = (state: EntityState) => state.assets;
export const selectDetections = (state: EntityState) => state.detections;
export const selectTrackCount = (state: EntityState) => state.trackCount;
export const selectAssetCount = (state: EntityState) => state.assetCount;
export const selectLastChange = (state: EntityState) => state.lastChange;
export const selectDetectionEntityIds = (state: EntityState) => state.detectionEntityIds;
export const selectSelfGeo = (state: EntityState) => state.selfGeo;

function computeDerivedState(entities: Map<string, Entity>) {
  const tracks: Entity[] = [];
  const assets: Entity[] = [];
  const detections: Entity[] = [];

  for (const entity of entities.values()) {
    if (isExpired(entity)) continue;
    if (isDetectionEntity(entity)) {
      detections.push(entity);
    }
    if (isTrack(entity)) {
      tracks.push(entity);
    } else if (isAsset(entity) && !isDetectionEntity(entity)) {
      assets.push(entity);
    }
  }

  const sortByName = (a: Entity, b: Entity) => {
    const nameA = getEntityName(a);
    const nameB = getEntityName(b);
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  };

  tracks.sort(sortByName);
  assets.sort(sortByName);
  detections.sort((a, b) => {
    return timestampToMs(b.lifetime?.from) - timestampToMs(a.lifetime?.from);
  });

  return {
    tracks,
    assets,
    detections,
    trackCount: tracks.length,
    assetCount: assets.length,
  };
}

function scheduleDerivedStateUpdate() {
  if (derivedStateTimeout) return;
  derivedStateTimeout = setTimeout(() => {
    derivedStateTimeout = null;
    const state = useEntityStore.getState();
    useEntityStore.setState(computeDerivedState(state.entities));
  }, DERIVED_STATE_INTERVAL_MS);
}

export const useEntityStore = create<EntityState & EntityActions>()((set) => ({
  entities: new Map(),
  detectionEntityIds: new Set(),
  tracks: [],
  assets: [],
  detections: [],
  trackCount: 0,
  assetCount: 0,
  selfGeo: null as GeoSpatialComponent | null,
  hydrisVersion: null as string | null,
  hydrisUpdateAvailable: null as string | null,
  isConnected: false,
  error: null,
  lastChange: EMPTY_CHANGE,

  startStream: () => {
    if (abortController) return;

    abortController = new AbortController();
    set({ error: null });

    const backoff = createBackoff(250, 5000);

    const pendingUpdates = new Map<string, Entity>();
    const pendingDeletes = new Set<string>();
    let flushScheduled = false;

    const flushUpdates = () => {
      flushScheduled = false;
      if (pendingUpdates.size === 0 && pendingDeletes.size === 0) return;

      const updatedIds = new Set(pendingUpdates.keys());

      let geoChanged = pendingDeletes.size > 0;

      if (!geoChanged) {
        for (const [id, entity] of pendingUpdates) {
          if (hasGeoMoved(id, entity.geo)) {
            geoChanged = true;
            break;
          }
        }
      }

      set((state) => {
        let hasChanges = false;

        for (const id of pendingDeletes) {
          if (state.entities.has(id)) {
            hasChanges = true;
            break;
          }
        }

        if (!hasChanges) {
          for (const [id, entity] of pendingUpdates) {
            const existing = state.entities.get(id);
            if (existing !== entity) {
              hasChanges = true;
              break;
            }
          }
        }

        if (!hasChanges) {
          pendingUpdates.clear();
          pendingDeletes.clear();
          return state;
        }

        const massDeletion = pendingDeletes.size > 1000;

        if (massDeletion) {
          const survived = new Map<string, Entity>();
          for (const [id, entity] of state.entities) {
            if (!pendingDeletes.has(id)) survived.set(id, entity);
          }
          state.entities.clear();
          previousPositions.clear();
          state.detectionEntityIds.clear();
          for (const [id, entity] of survived) {
            state.entities.set(id, entity);
            trackPosition(id, entity.geo);
            if (isDetectionEntity(entity)) state.detectionEntityIds.add(id);
          }
        } else {
          for (const id of pendingDeletes) {
            state.entities.delete(id);
            previousPositions.delete(id);
            state.detectionEntityIds.delete(id);
          }
        }

        for (const [id, entity] of pendingUpdates) {
          state.entities.set(id, entity);
          trackPosition(id, entity.geo);
          if (isDetectionEntity(entity)) {
            state.detectionEntityIds.add(id);
          } else {
            state.detectionEntityIds.delete(id);
          }
        }

        const deletedIds = new Set(pendingDeletes);

        pendingUpdates.clear();
        pendingDeletes.clear();

        changeVersion++;
        const lastChange: ChangeSet = {
          version: changeVersion,
          updatedIds,
          deletedIds,
          geoChanged,
        };

        accumulateChanges(lastChange);
        if (updatedIds.size > 0 || deletedIds.size > 0) scheduleDerivedStateUpdate();

        return { lastChange };
      });
    };

    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      flushTimeout = setTimeout(flushUpdates, BATCH_INTERVAL_MS);
    };

    function handleStreamError(err: Error) {
      const signal = abortController?.signal;
      if (signal?.aborted) return;

      console.error(
        "[entity-store] stream error:",
        err,
        "entities:",
        useEntityStore.getState().entities.size,
      );
      set({ error: err, isConnected: false });

      const delay = backoff.next();

      reconnectTimeout = setTimeout(() => {
        if (signal?.aborted) return;

        pendingUpdates.clear();
        pendingDeletes.clear();
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        if (derivedStateTimeout) {
          clearTimeout(derivedStateTimeout);
          derivedStateTimeout = null;
        }
        flushScheduled = false;

        const state = useEntityStore.getState();
        if (state.entities.size > 0) {
          state.entities.clear();
          state.detectionEntityIds.clear();
          previousPositions.clear();
          changeVersion++;
          const lastChange: ChangeSet = {
            version: changeVersion,
            updatedIds: new Set(),
            deletedIds: new Set(),
            geoChanged: true,
            fullClear: true,
          };
          accumulateChanges(lastChange);
          set({
            lastChange,
            tracks: [],
            assets: [],
            trackCount: 0,
            assetCount: 0,
          });
        }

        stream();
      }, delay);
    }

    function fetchHydrisVersion() {
      if (useEntityStore.getState().hydrisVersion) return;
      worldClient.getLocalNode({}).then(
        (res) => {
          const node = res.entity?.device?.node;
          const v = node?.hydrisVersion ?? null;
          const update = node?.hydrisUpdateAvailable ?? null;
          const geo = res.entity?.geo ?? null;
          set({
            ...(v ? { hydrisVersion: v } : {}),
            ...(update ? { hydrisUpdateAvailable: update } : {}),
            ...(geo ? { selfGeo: geo } : {}),
          });
        },
        () => {},
      );
    }

    async function stream() {
      if (!abortController) return;
      const signal = abortController.signal;

      try {
        const { entities: initial } = await worldClient.listEntities(
          { filter: ENTITY_STREAM_FILTER },
          { signal },
        );
        if (signal.aborted) return;

        if (initial.length > 0) {
          set((state) => {
            const updatedIds = new Set<string>();

            for (const entity of initial) {
              if (!entity.id) continue;
              state.entities.set(entity.id, entity);
              updatedIds.add(entity.id);

              trackPosition(entity.id, entity.geo);
              if (isDetectionEntity(entity)) {
                state.detectionEntityIds.add(entity.id);
              }
            }

            changeVersion++;
            const lastChange: ChangeSet = {
              version: changeVersion,
              updatedIds,
              deletedIds: new Set(),
              geoChanged: true,
            };
            accumulateChanges(lastChange);
            scheduleDerivedStateUpdate();

            return {
              lastChange,
              isConnected: true,
              error: null,
            };
          });
          backoff.reset();
        }

        fetchHydrisVersion();

        let receivedFirst = initial.length > 0;
        let eventsSinceYield = 0;
        for await (const event of worldClient.watchEntities(
          { filter: ENTITY_STREAM_FILTER, behaviour: { maxRateHz: 10000 } },
          { signal },
        )) {
          if (signal.aborted) break;

          if (!receivedFirst) {
            set({ isConnected: true, error: null });
            backoff.reset();
            receivedFirst = true;
          }

          classifyEvent(event, pendingUpdates, pendingDeletes);
          scheduleFlush();

          if (++eventsSinceYield >= 200) {
            eventsSinceYield = 0;
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        }
      } catch (err) {
        handleStreamError(err as Error);
      }
    }

    stream();
  },

  stopStream: () => {
    abortController?.abort();
    abortController = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    if (derivedStateTimeout) {
      clearTimeout(derivedStateTimeout);
      derivedStateTimeout = null;
    }
    set({ isConnected: false });
  },

  updateEntity: (id, updates) => {
    set((state) => {
      const existing = state.entities.get(id);
      if (!existing) return state;

      const updated = { ...existing, ...updates };
      state.entities.set(id, updated);

      if (isDetectionEntity(updated)) {
        state.detectionEntityIds.add(id);
      } else {
        state.detectionEntityIds.delete(id);
      }

      const geoChanged = hasGeoMoved(id, updated.geo);
      trackPosition(id, updated.geo);

      changeVersion++;
      const lastChange: ChangeSet = {
        version: changeVersion,
        updatedIds: new Set([id]),
        deletedIds: new Set(),
        geoChanged,
      };
      accumulateChanges(lastChange);
      scheduleDerivedStateUpdate();
      return { lastChange };
    });
  },

  fetchEntity: async (id) => {
    try {
      const response = await worldClient.getEntity({ id });
      if (response.entity) {
        const entity = response.entity;
        set((state) => {
          state.entities.set(id, entity);

          if (isDetectionEntity(entity)) {
            state.detectionEntityIds.add(id);
          } else {
            state.detectionEntityIds.delete(id);
          }

          const geoChanged = hasGeoMoved(id, entity.geo);
          trackPosition(id, entity.geo);

          changeVersion++;
          const lastChange: ChangeSet = {
            version: changeVersion,
            updatedIds: new Set([id]),
            deletedIds: new Set(),
            geoChanged,
          };
          accumulateChanges(lastChange);
          scheduleDerivedStateUpdate();
          return { lastChange };
        });
        return entity;
      }
      return null;
    } catch {
      return null;
    }
  },

  reset: () => {
    abortController?.abort();
    abortController = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    if (derivedStateTimeout) {
      clearTimeout(derivedStateTimeout);
      derivedStateTimeout = null;
    }
    previousPositions.clear();
    changeVersion = 0;
    resetDeltaState();
    set({
      entities: new Map(),
      detectionEntityIds: new Set(),
      tracks: [],
      assets: [],
      detections: [],
      trackCount: 0,
      assetCount: 0,
      isConnected: false,
      error: null,
      lastChange: EMPTY_CHANGE,
    });
  },
}));
