import type { Entity, GeoSpatialComponent } from "@projectqai/proto/world";
import { DeviceState, Priority, SortField } from "@projectqai/proto/world";
import { create } from "zustand";

import {
  getBattleDimensionRank,
  getEntityName,
  isAsset,
  isDetectionEntity,
  isTrack,
  timestampToMs,
} from "../../../lib/api/use-track-utils";
import { worldClient } from "../../../lib/api/world-client";
import { createBackoff } from "../../../lib/backoff";
import { readinessSeverity } from "../utils/asset-readiness";
import type { ChangeSet } from "../utils/transform-entities";
import { accumulateChanges, resetDeltaState } from "../utils/transform-entities";
import type { ListSortField, SortConfig } from "./left-panel-store";
import { useLeftPanelStore } from "./left-panel-store";
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
    { component: [16] }, // detection: contact reports, incl. detections with no geo and no bearing
    { component: [50] }, // device: config tree
    { component: [52] }, // configurable: orphaned configs (no device component)
    { component: [25] }, // shape: coverage, history, prediction
    { component: [23] }, // taskable: action buttons
    { component: [63] }, // map_layer: plugin map overlays
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
  resortEntities: () => void;
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

export const selectDetectionsByDetector = (detectorEntityId: string) => (state: EntityState) => {
  const result: Entity[] = [];
  for (const id of state.detectionEntityIds) {
    const entity = state.entities.get(id);
    if (entity?.detection?.detectorEntityId === detectorEntityId) result.push(entity);
  }
  return result;
};

function entitySortComparator(sort: SortConfig) {
  const dir = sort.descending ? -1 : 1;
  return (a: Entity, b: Entity) => {
    const fieldComparison = compareByField(a, b, sort.field);
    if (fieldComparison !== 0) return fieldComparison * dir;
    if (sort.field === SortField.SortFieldLabel) return 0;
    const nameA = getEntityName(a);
    const nameB = getEntityName(b);
    const byName = nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    return byName * dir;
  };
}

// worse = higher, same direction as BLOCKER_SEVERITY in asset-readiness.ts
const DEVICE_STATE_SEVERITY: Record<DeviceState, number> = {
  [DeviceState.DeviceStateActive]: 0,
  [DeviceState.DeviceStatePending]: 1,
  [DeviceState.DeviceStateDegraded]: 2,
  [DeviceState.DeviceStateFailed]: 3,
};

function deviceSeverity(state: DeviceState | undefined): number {
  return state === undefined ? -1 : DEVICE_STATE_SEVERITY[state];
}

function compareByField(a: Entity, b: Entity, field: ListSortField): number {
  switch (field) {
    case SortField.SortFieldLabel: {
      const nameA = getEntityName(a);
      const nameB = getEntityName(b);
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    }
    case SortField.SortFieldPriority:
      return (a.priority ?? 0) - (b.priority ?? 0);
    case SortField.SortFieldLifetimeFrom:
      return timestampToMs(a.lifetime?.from) - timestampToMs(b.lifetime?.from);
    case SortField.SortFieldLifetimeUntil:
      return timestampToMs(a.lifetime?.until) - timestampToMs(b.lifetime?.until);
    case SortField.SortFieldLifetimeFresh:
      return timestampToMs(a.lifetime?.fresh) - timestampToMs(b.lifetime?.fresh);
    case SortField.SortFieldGeoAltitude:
      return compareNullableNumbers(a.geo?.altitude, b.geo?.altitude);
    case SortField.SortFieldGeoLatitude:
      return compareNullableNumbers(a.geo?.latitude, b.geo?.latitude);
    case SortField.SortFieldGeoLongitude:
      return compareNullableNumbers(a.geo?.longitude, b.geo?.longitude);
    case SortField.SortFieldClassificationIdentity:
      return (a.classification?.identity ?? 0) - (b.classification?.identity ?? 0);
    case SortField.SortFieldClassificationDimension:
      return getBattleDimensionRank(a) - getBattleDimensionRank(b);
    case SortField.SortFieldBearingAzimuth:
      return compareNullableNumbers(a.bearing?.azimuth, b.bearing?.azimuth);
    case SortField.SortFieldBearingElevation:
      return compareNullableNumbers(a.bearing?.elevation, b.bearing?.elevation);
    case SortField.SortFieldLinkLastSeen:
      return timestampToMs(a.link?.lastSeen) - timestampToMs(b.link?.lastSeen);
    case SortField.SortFieldLinkQuality:
      return compareNullableNumbers(a.link?.linkQualityPercent, b.link?.linkQualityPercent);
    case SortField.SortFieldPowerBatteryCharge:
      return compareNullableNumbers(
        a.power?.batteryChargeRemaining,
        b.power?.batteryChargeRemaining,
      );
    case SortField.SortFieldDeviceState:
      return deviceSeverity(a.device?.state) - deviceSeverity(b.device?.state);
    case "readiness":
      return readinessSeverity(a) - readinessSeverity(b);
    default:
      return 0;
  }
}

export function hasSortValue(entity: Entity, field: ListSortField): boolean {
  switch (field) {
    case SortField.SortFieldLabel:
      return true;
    case SortField.SortFieldPriority:
      return entity.priority != null;
    case SortField.SortFieldLifetimeFrom:
      return entity.lifetime?.from != null;
    case SortField.SortFieldLifetimeFresh:
      return entity.lifetime?.fresh != null;
    case SortField.SortFieldGeoAltitude:
      return entity.geo?.altitude != null;
    case SortField.SortFieldClassificationIdentity:
      return entity.classification?.identity != null;
    case SortField.SortFieldClassificationDimension:
      return getBattleDimensionRank(entity) !== 0;
    case SortField.SortFieldBearingAzimuth:
      return entity.bearing?.azimuth != null;
    case SortField.SortFieldLinkLastSeen:
      return entity.link?.lastSeen != null;
    case SortField.SortFieldLinkQuality:
      return entity.link?.linkQualityPercent != null;
    case SortField.SortFieldPowerBatteryCharge:
      return entity.power?.batteryChargeRemaining != null;
    case "readiness":
      return isAsset(entity);
    case SortField.SortFieldDeviceState:
      return entity.device?.state != null;
    default:
      return false;
  }
}

function compareNullableNumbers(
  a: number | undefined | null,
  b: number | undefined | null,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function computeDerivedState(entities: Map<string, Entity>, sort: SortConfig) {
  const tracks: Entity[] = [];
  const assets: Entity[] = [];
  const detections: Entity[] = [];

  for (const entity of entities.values()) {
    if (isDetectionEntity(entity)) {
      detections.push(entity);
    }
    if (isTrack(entity)) {
      tracks.push(entity);
    } else if (isAsset(entity)) {
      assets.push(entity);
    }
  }

  const comparator = entitySortComparator(sort);
  // readiness is an asset-only sort; sort tracks by name instead so we don't
  // derive readiness for thousands of tracks on every flush.
  const trackComparator =
    sort.field === "readiness"
      ? entitySortComparator({ field: SortField.SortFieldLabel, descending: sort.descending })
      : comparator;
  tracks.sort(trackComparator);
  assets.sort(comparator);
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
    const { sort } = useLeftPanelStore.getState();
    useEntityStore.setState(computeDerivedState(state.entities, sort));
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
    const controller = abortController;
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
      const signal = controller.signal;
      if (signal.aborted) return;

      set({ error: err, isConnected: false });

      const delay = backoff.next();

      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(() => {
        if (signal.aborted) return;

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
            detections: [],
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
      const signal = controller.signal;
      if (signal.aborted) return;

      try {
        const { sort } = useLeftPanelStore.getState();
        // the server only knows proto fields; the derived "readiness" sort is
        // applied client-side, so fall back to label for the stream order.
        const serverField = typeof sort.field === "number" ? sort.field : SortField.SortFieldLabel;
        const sortOptions = [{ field: serverField, descending: sort.descending }];

        fetchHydrisVersion();

        let receivedFirst = false;
        let eventsSinceYield = 0;
        for await (const event of worldClient.watchEntities(
          { filter: ENTITY_STREAM_FILTER, sort: sortOptions, behaviour: { maxRateHz: 10000 } },
          { signal },
        )) {
          if (signal.aborted) break;

          if (!receivedFirst) {
            set({ isConnected: true, error: null });
            backoff.reset();
            receivedFirst = true;
          }

          classifyEvent(event, pendingUpdates, pendingDeletes);
          const priority = event.entity?.priority ?? Priority.PriorityUnspecified;
          if (priority >= Priority.PriorityImmediate) {
            if (flushTimeout) {
              clearTimeout(flushTimeout);
              flushTimeout = null;
            }
            flushUpdates();
          } else {
            scheduleFlush();
          }

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

  resortEntities: () => {
    const state = useEntityStore.getState();
    if (state.entities.size === 0) return;
    const { sort } = useLeftPanelStore.getState();
    useEntityStore.setState(computeDerivedState(state.entities, sort));
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

let prevSort = useLeftPanelStore.getState().sort;
useLeftPanelStore.subscribe((state) => {
  const { sort } = state;
  if (sort.field !== prevSort.field || sort.descending !== prevSort.descending) {
    prevSort = sort;
    useEntityStore.getState().resortEntities();
  }
});
