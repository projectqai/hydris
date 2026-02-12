import type { Entity } from "@projectqai/proto/world";
import { create } from "zustand";

import { getEntityName, isAsset, isExpired, isTrack } from "../../../lib/api/use-track-utils";
import { worldClient } from "../../../lib/api/world-client";
import { accumulateChanges, resetDeltaState } from "../utils/transform-entities";
import { classifyEvent } from "./process-events";

const BATCH_INTERVAL_MS = 250;
const DERIVED_STATE_INTERVAL_MS = 500;

let abortController: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let derivedStateTimeout: ReturnType<typeof setTimeout> | null = null;

const previousPositions = new Map<string, { lat: number; lng: number }>();
let changeVersion = 0;

export type ChangeSet = {
  version: number;
  updatedIds: Set<string>;
  deletedIds: Set<string>;
  geoChanged: boolean;
  fullClear?: boolean;
};

function isDetectionEntity(entity: Entity): boolean {
  const detectorId = entity.detection?.detectorEntityId;
  return (
    detectorId !== undefined &&
    detectorId !== "" &&
    entity.bearing?.azimuth !== undefined &&
    entity.bearing?.elevation !== undefined
  );
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
  trackCount: number;
  assetCount: number;
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
export const selectTrackCount = (state: EntityState) => state.trackCount;
export const selectAssetCount = (state: EntityState) => state.assetCount;
export const selectLastChange = (state: EntityState) => state.lastChange;
export const selectDetectionEntityIds = (state: EntityState) => state.detectionEntityIds;

function computeDerivedState(entities: Map<string, Entity>) {
  const tracks: Entity[] = [];
  const assets: Entity[] = [];

  for (const entity of entities.values()) {
    if (isExpired(entity)) continue;
    if (isTrack(entity)) {
      tracks.push(entity);
    } else if (isAsset(entity)) {
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

  return {
    tracks,
    assets,
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
  trackCount: 0,
  assetCount: 0,
  isConnected: false,
  error: null,
  lastChange: EMPTY_CHANGE,

  startStream: () => {
    if (abortController) return;

    abortController = new AbortController();
    set({ error: null });

    const maxReconnectDuration = 60000;
    let reconnectStartTime: number | null = null;

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
          if (!entity.geo) continue;
          const prev = previousPositions.get(id);
          if (!prev || prev.lat !== entity.geo.latitude || prev.lng !== entity.geo.longitude) {
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
            if (entity.geo) {
              previousPositions.set(id, { lat: entity.geo.latitude, lng: entity.geo.longitude });
            }
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
          if (entity.geo) {
            previousPositions.set(id, {
              lat: entity.geo.latitude,
              lng: entity.geo.longitude,
            });
          }
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

      if (reconnectStartTime === null) {
        reconnectStartTime = Date.now();
      }

      const elapsed = Date.now() - reconnectStartTime;

      if (elapsed < maxReconnectDuration) {
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
        }, 1000);
      } else {
        console.error("[entity-store] max reconnect duration reached");
      }
    }

    async function stream() {
      if (!abortController) return;
      const signal = abortController.signal;

      try {
        const { entities: initial } = await worldClient.listEntities({}, { signal });
        if (signal.aborted) return;

        if (initial.length > 0) {
          set((state) => {
            const updatedIds = new Set<string>();

            for (const entity of initial) {
              if (!entity.id) continue;
              state.entities.set(entity.id, entity);
              updatedIds.add(entity.id);

              if (entity.geo) {
                previousPositions.set(entity.id, {
                  lat: entity.geo.latitude,
                  lng: entity.geo.longitude,
                });
              }
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
          reconnectStartTime = null;
        }

        let receivedFirst = initial.length > 0;
        let eventsSinceYield = 0;
        for await (const event of worldClient.watchEntities(
          { behaviour: { maxRateHz: 10000 } },
          { signal },
        )) {
          if (signal.aborted) break;

          if (!receivedFirst) {
            set({ isConnected: true, error: null });
            reconnectStartTime = null;
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

      const prevPos = previousPositions.get(id);
      const geoChanged =
        updated.geo &&
        (!prevPos || prevPos.lat !== updated.geo.latitude || prevPos.lng !== updated.geo.longitude);

      if (updated.geo) {
        previousPositions.set(id, {
          lat: updated.geo.latitude,
          lng: updated.geo.longitude,
        });
      }

      changeVersion++;
      const lastChange: ChangeSet = {
        version: changeVersion,
        updatedIds: new Set([id]),
        deletedIds: new Set(),
        geoChanged: !!geoChanged,
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

          const prevPos = previousPositions.get(id);
          const geoChanged =
            entity.geo &&
            (!prevPos ||
              prevPos.lat !== entity.geo.latitude ||
              prevPos.lng !== entity.geo.longitude);

          if (entity.geo) {
            previousPositions.set(id, {
              lat: entity.geo.latitude,
              lng: entity.geo.longitude,
            });
          }

          changeVersion++;
          const lastChange: ChangeSet = {
            version: changeVersion,
            updatedIds: new Set([id]),
            deletedIds: new Set(),
            geoChanged: !!geoChanged,
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
      trackCount: 0,
      assetCount: 0,
      isConnected: false,
      error: null,
      lastChange: EMPTY_CHANGE,
    });
  },
}));
