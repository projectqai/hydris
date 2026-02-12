import type {
  ActiveSensorSectors,
  Affiliation,
  EntityData,
  GeoPosition,
  ShapeGeometry,
} from "@hydris/map-engine/types";
import type { Entity, PlanarPolygon, PlanarRing } from "@projectqai/proto/world";

import { isExpired } from "../../../lib/api/use-track-utils";
import type { ChangeSet } from "../store/entity-store";
import { degreesToSectors } from "./sensors";

export type SerializedEntityData = Omit<EntityData, "activeSectors"> & {
  activeSectors?: string[];
};

export type SerializedDelta = {
  version: number;
  geoChanged: boolean;
  entities: SerializedEntityData[];
  removed: string[];
  fullRebuild?: boolean;
};

function getAffiliation(sidc?: string): Affiliation {
  const code = sidc?.[1]?.toUpperCase();
  if (code === "F") return "blue";
  if (code === "H") return "red";
  if (code === "N") return "neutral";
  return "unknown";
}

function hasGeo(entity: Entity): entity is Entity & { geo: NonNullable<Entity["geo"]> } {
  return !!entity.geo;
}

function hasEllipse(entity: Entity): boolean {
  if (!entity.symbol) return false;
  const { milStd2525C } = entity.symbol;
  const sensorSymbolRegex = /^SFGPES-*$/gm;
  return milStd2525C.match(sensorSymbolRegex) !== null;
}

function ringToPositions(ring: PlanarRing): GeoPosition[] {
  return ring.points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
    alt: p.altitude,
  }));
}

function computeCentroid(positions: GeoPosition[]): GeoPosition {
  const sum = positions.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
    lat: 0,
    lng: 0,
  });
  return { lat: sum.lat / positions.length, lng: sum.lng / positions.length };
}

function extractShape(entity: Entity): ShapeGeometry | undefined {
  const plane = entity.shape?.geometry?.planar?.plane;
  if (!plane || plane.case === undefined) return undefined;

  switch (plane.case) {
    case "polygon": {
      const poly = plane.value as PlanarPolygon;
      if (!poly.outer) return undefined;
      return {
        type: "polygon",
        outer: ringToPositions(poly.outer),
        holes: poly.holes.length ? poly.holes.map(ringToPositions) : undefined,
      };
    }
    case "line":
      return { type: "polyline", points: ringToPositions(plane.value as PlanarRing) };
    case "point": {
      const pt = plane.value as { latitude: number; longitude: number; altitude?: number };
      return { type: "point", position: { lat: pt.latitude, lng: pt.longitude, alt: pt.altitude } };
    }
    default:
      return undefined;
  }
}

function transformEntity(entity: Entity): Omit<EntityData, "activeSectors"> | null {
  if (isExpired(entity)) return null;

  const shape = extractShape(entity);
  const hasPosition = hasGeo(entity);

  if (!hasPosition && !shape) return null;

  let position: GeoPosition;
  if (hasPosition) {
    position = {
      lat: entity.geo.latitude,
      lng: entity.geo.longitude,
      alt: entity.geo.altitude,
    };
  } else if (shape!.type === "point") {
    position = shape!.position;
  } else {
    const pts = shape!.type === "polygon" ? shape!.outer : shape!.points;
    position = computeCentroid(pts);
  }

  return {
    id: entity.id,
    position,
    shape,
    symbol: entity.symbol?.milStd2525C,
    label: entity.label || entity.id,
    affiliation: getAffiliation(entity.symbol?.milStd2525C),
    ellipseRadius: hasEllipse(entity) ? 250 : undefined,
  };
}

function computeDetectorSectors(
  entities: Map<string, Entity>,
  detectionEntityIds: Set<string>,
): Map<string, ActiveSensorSectors> {
  const detectorSectors = new Map<string, ActiveSensorSectors>();

  if (detectionEntityIds.size === 0) return detectorSectors;

  for (const id of detectionEntityIds) {
    const entity = entities.get(id);
    if (!entity) continue;
    if (isExpired(entity)) continue;

    const detectorId = entity.detection?.detectorEntityId;
    const azimuth = entity.bearing?.azimuth;
    const elevation = entity.bearing?.elevation;

    if (detectorId === undefined || azimuth === undefined || elevation === undefined) continue;

    const sectors: ActiveSensorSectors = degreesToSectors([{ mid: azimuth, width: elevation }]);

    if (sectors.size > 0) {
      const existing = detectorSectors.get(detectorId) ?? new Set();
      for (const sector of sectors) {
        existing.add(sector);
      }
      detectorSectors.set(detectorId, existing);
    }
  }

  return detectorSectors;
}

function serializeEntity(
  e: Omit<EntityData, "activeSectors">,
  activeSectors?: ActiveSensorSectors,
): SerializedEntityData {
  return {
    ...e,
    activeSectors: activeSectors ? Array.from(activeSectors) : undefined,
  };
}

export function deserializeEntity(e: SerializedEntityData): EntityData {
  return {
    ...e,
    activeSectors: e.activeSectors
      ? (new Set(e.activeSectors) as EntityData["activeSectors"])
      : undefined,
  };
}

let isFirstBuild = true;
const accumulatedUpdatedIds = new Set<string>();
const accumulatedDeletedIds = new Set<string>();
let accumulatedGeoChanged = false;
let accumulatedVersion = 0;
let accumulatedFullClear = false;

export function accumulateChanges(change: ChangeSet): void {
  if (change.fullClear) {
    accumulatedUpdatedIds.clear();
    accumulatedDeletedIds.clear();
    accumulatedFullClear = true;
    for (const id of change.updatedIds) {
      accumulatedUpdatedIds.add(id);
    }
  } else {
    for (const id of change.updatedIds) {
      accumulatedUpdatedIds.add(id);
      accumulatedDeletedIds.delete(id);
    }
    for (const id of change.deletedIds) {
      accumulatedDeletedIds.add(id);
      accumulatedUpdatedIds.delete(id);
    }
  }
  accumulatedGeoChanged = accumulatedGeoChanged || change.geoChanged;
  accumulatedVersion = change.version;
}

export function buildDelta(
  entities: Map<string, Entity>,
  detectionEntityIds: Set<string>,
): SerializedDelta {
  const detectorSectors = computeDetectorSectors(entities, detectionEntityIds);

  if (isFirstBuild) {
    isFirstBuild = false;
    accumulatedUpdatedIds.clear();
    accumulatedDeletedIds.clear();
    accumulatedGeoChanged = false;

    const result: SerializedEntityData[] = [];
    for (const entity of entities.values()) {
      const transformed = transformEntity(entity);
      if (transformed) {
        result.push(serializeEntity(transformed, detectorSectors.get(entity.id)));
      }
    }
    return {
      version: accumulatedVersion,
      geoChanged: true,
      entities: result,
      removed: [],
      fullRebuild: true,
    };
  }

  if (accumulatedFullClear) {
    const version = accumulatedVersion;
    accumulatedUpdatedIds.clear();
    accumulatedDeletedIds.clear();
    accumulatedGeoChanged = false;
    accumulatedFullClear = false;

    const result: SerializedEntityData[] = [];
    for (const entity of entities.values()) {
      const transformed = transformEntity(entity);
      if (transformed) {
        result.push(serializeEntity(transformed, detectorSectors.get(entity.id)));
      }
    }
    return {
      version,
      geoChanged: true,
      entities: result,
      removed: [],
      fullRebuild: true,
    };
  }

  const changed: SerializedEntityData[] = [];
  const removed: string[] = Array.from(accumulatedDeletedIds);

  const affectedDetectorIds = new Set<string>();
  for (const [detectorId] of detectorSectors) {
    affectedDetectorIds.add(detectorId);
  }

  const idsToProcess = new Set(accumulatedUpdatedIds);
  for (const detectorId of affectedDetectorIds) {
    idsToProcess.add(detectorId);
  }

  for (const id of idsToProcess) {
    const entity = entities.get(id);
    if (entity) {
      const transformed = transformEntity(entity);
      if (transformed) {
        changed.push(serializeEntity(transformed, detectorSectors.get(id)));
      } else if (accumulatedUpdatedIds.has(id)) {
        removed.push(id);
      }
    }
  }

  const geoChanged = accumulatedGeoChanged || removed.length > 0;
  const version = accumulatedVersion;

  accumulatedUpdatedIds.clear();
  accumulatedDeletedIds.clear();
  accumulatedGeoChanged = false;

  return {
    version,
    geoChanged,
    entities: changed,
    removed,
  };
}

export function* buildDeltaChunked(
  entities: Map<string, Entity>,
  detectionEntityIds: Set<string>,
  chunkSize: number,
): Generator<SerializedDelta> {
  const detectorSectors = computeDetectorSectors(entities, detectionEntityIds);
  const version = accumulatedVersion;
  const needsFullRebuild = isFirstBuild || accumulatedFullClear;

  if (needsFullRebuild) {
    isFirstBuild = false;
    accumulatedUpdatedIds.clear();
    accumulatedDeletedIds.clear();
    accumulatedGeoChanged = false;
    accumulatedFullClear = false;

    let chunk: SerializedEntityData[] = [];
    let isFirst = true;

    for (const entity of entities.values()) {
      const transformed = transformEntity(entity);
      if (!transformed) continue;
      chunk.push(serializeEntity(transformed, detectorSectors.get(entity.id)));

      if (chunk.length >= chunkSize) {
        yield {
          version,
          geoChanged: true,
          entities: chunk,
          removed: [],
          fullRebuild: isFirst || undefined,
        };
        chunk = [];
        isFirst = false;
      }
    }

    if (chunk.length > 0 || isFirst) {
      yield {
        version,
        geoChanged: true,
        entities: chunk,
        removed: [],
        fullRebuild: isFirst || undefined,
      };
    }
    return;
  }

  yield buildDelta(entities, detectionEntityIds);
}

export function hasPendingDelta(): boolean {
  return accumulatedUpdatedIds.size > 0 || accumulatedDeletedIds.size > 0 || accumulatedFullClear;
}

export function resetDeltaState(): void {
  isFirstBuild = true;
  accumulatedUpdatedIds.clear();
  accumulatedDeletedIds.clear();
  accumulatedGeoChanged = false;
  accumulatedFullClear = false;
  accumulatedVersion = 0;
}
