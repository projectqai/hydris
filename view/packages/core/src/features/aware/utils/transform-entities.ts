import type {
  ActiveSensorSectors,
  Affiliation,
  EntityData,
  GeoPosition,
  ShapeGeometry,
  ShapeLineStyle,
} from "@hydris/map-engine/types";
import { circleToPolygon } from "@hydris/map-engine/utils/geodesic-circle";
import type {
  PlanarCircle,
  PlanarGeometry,
  PlanarPolygon,
  PlanarRing,
} from "@projectqai/proto/geometry";
import { LineStyle } from "@projectqai/proto/geometry";
import type { Entity } from "@projectqai/proto/world";

import type { TrackStatus } from "../../../lib/api/use-track-utils";
import { getTrackStatus, isExpired } from "../../../lib/api/use-track-utils";
import { degreesToSectors } from "./sensors";

export type ChangeSet = {
  version: number;
  updatedIds: Set<string>;
  deletedIds: Set<string>;
  geoChanged: boolean;
  fullClear?: boolean;
};

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

const AFFILIATION: Record<TrackStatus, Affiliation> = {
  Blue: "blue",
  Red: "red",
  Neutral: "neutral",
  Unknown: "unknown",
  Unclassified: "unclassified",
};

function getAffiliation(entity: Entity): Affiliation {
  return AFFILIATION[getTrackStatus(entity)];
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

export function shapeCentroid(shape: ShapeGeometry): GeoPosition | null {
  switch (shape.type) {
    case "point":
      return shape.position;
    case "polygon":
      return computeCentroid(shape.outer);
    case "polyline":
      return computeCentroid(shape.points);
    case "collection": {
      for (const sub of shape.geometries) {
        const c = shapeCentroid(sub);
        if (c) return c;
      }
      return null;
    }
  }
}

const LINE_STYLE_MAP: Record<number, ShapeLineStyle> = {
  [LineStyle.LineStyleDashed]: "dashed",
  [LineStyle.LineStyleDotted]: "dotted",
};

function toLineStyle(style?: LineStyle): ShapeLineStyle | undefined {
  if (style === undefined) return undefined;
  return LINE_STYLE_MAP[style];
}

function extractGeometry(geom: PlanarGeometry): ShapeGeometry | undefined {
  const { plane } = geom;
  if (!plane || plane.case === undefined) return undefined;
  const lineStyle = toLineStyle(geom.lineStyle);

  switch (plane.case) {
    case "polygon": {
      const poly = plane.value as PlanarPolygon;
      if (!poly.outer) return undefined;
      return {
        type: "polygon",
        outer: ringToPositions(poly.outer),
        holes: poly.holes.length ? poly.holes.map(ringToPositions) : undefined,
        lineStyle,
      };
    }
    case "line":
      return { type: "polyline", points: ringToPositions(plane.value as PlanarRing), lineStyle };
    case "circle": {
      const circle = plane.value as PlanarCircle;
      if (!circle.center || !circle.radiusM) return undefined;
      const center: GeoPosition = { lat: circle.center.latitude, lng: circle.center.longitude };
      const shape = circleToPolygon(center, circle.radiusM, circle.innerRadiusM);
      if (lineStyle) shape.lineStyle = lineStyle;
      return shape;
    }
    case "point": {
      const pt = plane.value as { latitude: number; longitude: number; altitude?: number };
      return { type: "point", position: { lat: pt.latitude, lng: pt.longitude, alt: pt.altitude } };
    }
    case "collection": {
      const geometries: ShapeGeometry[] = [];
      for (const sub of plane.value.geometries) {
        const g = extractGeometry(sub);
        if (g) geometries.push(g);
      }
      return geometries.length ? { type: "collection", geometries } : undefined;
    }
    default:
      return undefined;
  }
}

export function extractShape(entity: Entity): ShapeGeometry | undefined {
  const planar = entity.shape?.geometry?.planar;
  if (!planar) return undefined;
  return extractGeometry(planar);
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
  } else {
    const pos = shapeCentroid(shape!);
    if (!pos) return null;
    position = pos;
  }

  const coverageIds = entity.sensor?.coverage;

  const parentId = entity.pose?.parent;
  const assemblyParentId = entity.assembly?.parent;
  const assemblyOutlineIds = entity.assembly?.outline;

  return {
    id: entity.id,
    position,
    shape,
    symbol: entity.symbol?.milStd2525C,
    label: entity.label || undefined,
    affiliation: getAffiliation(entity),
    ellipseRadius: hasEllipse(entity) ? 250 : undefined,
    trackHistoryId: entity.track?.history,
    trackPredictionId: entity.track?.prediction,
    coverageEntityIds: coverageIds?.length ? coverageIds : undefined,
    parentEntityId: parentId || undefined,
    assemblyParentId: assemblyParentId || undefined,
    assemblyOutlineIds: assemblyOutlineIds?.length ? assemblyOutlineIds : undefined,
    isDetection: entity.detection != null ? true : undefined,
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
let cachedDelta: SerializedDelta | null = null;
let cachedVersion = -1;

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
  if (cachedDelta && cachedVersion === accumulatedVersion) {
    return cachedDelta;
  }

  const detectorSectors = computeDetectorSectors(entities, detectionEntityIds);
  let result: SerializedDelta;

  if (isFirstBuild || accumulatedFullClear) {
    isFirstBuild = false;
    accumulatedFullClear = false;
    const version = accumulatedVersion;
    accumulatedUpdatedIds.clear();
    accumulatedDeletedIds.clear();
    accumulatedGeoChanged = false;

    const serialized: SerializedEntityData[] = [];
    for (const entity of entities.values()) {
      const transformed = transformEntity(entity);
      if (transformed) {
        serialized.push(serializeEntity(transformed, detectorSectors.get(entity.id)));
      }
    }
    result = {
      version,
      geoChanged: true,
      entities: serialized,
      removed: [],
      fullRebuild: true,
    };
  } else {
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

    result = { version, geoChanged, entities: changed, removed };
  }

  cachedDelta = result;
  cachedVersion = result.version;
  return result;
}

export function* buildDeltaChunked(
  entities: Map<string, Entity>,
  detectionEntityIds: Set<string>,
  chunkSize: number,
): Generator<SerializedDelta> {
  const delta = buildDelta(entities, detectionEntityIds);

  if (delta.entities.length <= chunkSize) {
    yield delta;
    return;
  }

  for (let i = 0; i < delta.entities.length; i += chunkSize) {
    yield {
      version: delta.version,
      geoChanged: delta.geoChanged,
      entities: delta.entities.slice(i, i + chunkSize),
      removed: i === 0 ? delta.removed : [],
      fullRebuild: i === 0 ? delta.fullRebuild : undefined,
    };
  }
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
  cachedDelta = null;
  cachedVersion = -1;
}
