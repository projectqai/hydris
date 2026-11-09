import type {
  ActiveSensorSectors,
  Affiliation,
  EditKind,
  EntityData,
  GeoPosition,
  PathPoint,
  ShapeGeometry,
  ShapeLineStyle,
} from "@hydris/map-engine/types";
import {
  circleToPolygon,
  destination,
  destinationDegrees,
} from "@hydris/map-engine/utils/geodesic-circle";
import type {
  PlanarCircle,
  PlanarGeometry,
  PlanarPoint,
  PlanarPolygon,
  PlanarRing,
} from "@projectqai/proto/geometry";
import { LineStyle } from "@projectqai/proto/geometry";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";

import { CONTROLLER_ID } from "../../../lib/api/controller-id";
import type { TrackStatus } from "../../../lib/api/use-track-utils";
import { getTrackStatus } from "../../../lib/api/use-track-utils";
import { deriveConnectorHealth } from "./connector-health";
import { degreesToSectors } from "./sensors";

export type ChangeSet = {
  version: number;
  updatedIds: Set<string>;
  deletedIds: Set<string>;
  geoChanged: boolean;
  fullClear?: boolean;
  // written by this client rather than streamed in, so it skips the render throttle
  local?: boolean;
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
  local?: boolean;
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

export function computeCentroid(positions: GeoPosition[]): GeoPosition {
  // offset against the first point so a shape spanning the antimeridian averages to its own side
  const referenceLng = positions[0]?.lng ?? 0;
  const sum = positions.reduce(
    (acc, p) => ({
      lat: acc.lat + p.lat,
      lng: acc.lng + (((p.lng - referenceLng + 540) % 360) - 180),
    }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: sum.lat / positions.length,
    lng: ((referenceLng + sum.lng / positions.length + 540) % 360) - 180,
  };
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

// Producers stamp their own controller id, which is the only thing separating a
// shape a person drew from one a device or feed emitted.
export function isDrawn(entity: Entity): boolean {
  return entity.controller?.id === CONTROLLER_ID && entity.shape != null;
}

// A circle stores a centre and a radius, so its edge handle is derived rather
// than read.
export type DrawnShape = {
  kind: EditKind;
  points: PathPoint[];
  rings?: number;
  radiusM?: number;
};

type PositionedPathPoint = Required<PathPoint>;

function readPlanarPoints(points: readonly PlanarPoint[]): PositionedPathPoint[] | undefined {
  const vertices: PositionedPathPoint[] = [];
  for (const point of points) {
    if (
      !Number.isFinite(point.latitude) ||
      Math.abs(point.latitude) > 90 ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.longitude) > 180 ||
      (point.altitude !== undefined && !Number.isFinite(point.altitude)) ||
      (point.entity && point.entity.trim() === "")
    ) {
      return undefined;
    }
    const position = {
      lat: point.latitude,
      lng: point.longitude,
      ...(point.altitude === undefined ? {} : { alt: point.altitude }),
    };
    vertices.push(
      point.entity
        ? { type: "entity", entityId: point.entity, lastKnownPosition: position }
        : { type: "coordinate", position },
    );
  }
  return vertices;
}

function readLineKind(entity: Entity, pointCount: number): "range" | "freeform" {
  if (pointCount > 2) return "freeform";

  // Two-point lines share one geometry. Their typed measurements preserve the
  // distinction; an absent measurement defaults to the anchoring R&B tool.
  const metrics = entity.metric?.metrics ?? [];
  const hasLength = metrics.some((metric) => metric.kind === MetricKind.MetricKindDistance);
  const hasBearing = metrics.some((metric) => metric.unit === MetricUnit.MetricUnitDegree);
  return hasLength && !hasBearing ? "freeform" : "range";
}

export function readDrawing(entity: Entity): DrawnShape | undefined {
  if (!isDrawn(entity)) return undefined;

  const plane = entity.shape?.geometry?.planar?.plane;
  switch (plane?.case) {
    case "line": {
      const points = plane.value.points;
      if (points.length < 2) return undefined;
      const vertices = readPlanarPoints(points);
      if (!vertices) return undefined;
      return { kind: readLineKind(entity, vertices.length), points: vertices };
    }
    case "circle": {
      const { center, radiusM } = plane.value;
      if (!center || !Number.isFinite(radiusM) || radiusM <= 0) return undefined;
      const centreVertex = readPlanarPoints([center])?.[0];
      const centre =
        centreVertex?.type === "coordinate"
          ? centreVertex.position
          : centreVertex?.lastKnownPosition;
      if (!centreVertex || !centre) return undefined;
      return {
        kind: "circle",
        radiusM,
        points: [
          // a centre dropped on an entity follows it, so the stored position is
          // only the snapshot another reader would draw with
          centreVertex,
          { type: "coordinate", position: destinationDegrees(centre, 90, radiusM) },
        ],
      };
    }
    case "collection": {
      // every ring sits at a whole multiple of the first, so the innermost one
      // carries everything needed to rebuild the set
      const rings = plane.value.geometries.filter(
        (child): child is PlanarGeometry & { plane: { case: "circle"; value: PlanarCircle } } =>
          child.plane.case === "circle",
      );
      const inner = rings[0];
      if (inner?.plane.case !== "circle") return undefined;
      let centreVertex: PositionedPathPoint | undefined;
      for (const ring of rings) {
        if (
          !ring.plane.value.center ||
          !Number.isFinite(ring.plane.value.radiusM) ||
          ring.plane.value.radiusM <= 0
        ) {
          return undefined;
        }
        const vertex = readPlanarPoints([ring.plane.value.center])?.[0];
        if (!vertex) return undefined;
        centreVertex ??= vertex;
      }
      if (!centreVertex) return undefined;
      const { radiusM } = inner.plane.value;
      const centre =
        centreVertex.type === "coordinate" ? centreVertex.position : centreVertex.lastKnownPosition;
      return {
        kind: "rb-circle",
        rings: rings.length,
        radiusM,
        points: [
          centreVertex,
          { type: "coordinate", position: destinationDegrees(centre, 90, radiusM) },
        ],
      };
    }
    case "polygon": {
      // the rectangle tool is the only thing that draws a polygon, so one that
      // is ours is a rectangle. its three placed corners rebuild it exactly.
      // the two depth edges leave their endpoints at right angles; the far edge
      // closes between them, so on a long shape its corners are not square.
      const corners = plane.value.outer?.points ?? [];
      if (corners.length < 4) return undefined;
      const vertices = readPlanarPoints(corners);
      if (!vertices) return undefined;
      const positions = vertices
        .slice(0, 3)
        .map((vertex) =>
          vertex.type === "coordinate" ? vertex.position : vertex.lastKnownPosition,
        );
      return {
        kind: "rectangle",
        points: positions.map((position) => ({ type: "coordinate", position })),
      };
    }
    default:
      return undefined;
  }
}

// Only a line carries range readouts, whether it was measured or drawn freehand.
export function readPathPoints(entity: Entity): PathPoint[] | undefined {
  const shape = readDrawing(entity);
  return shape?.kind === "range" || shape?.kind === "freeform" ? shape.points : undefined;
}

function imageBbox(center: GeoPosition, widthM: number, heightM: number) {
  const north = destination(center, 0, heightM / 2);
  const south = destination(center, Math.PI, heightM / 2);
  const east = destination(center, Math.PI / 2, widthM / 2);
  const west = destination(center, (3 * Math.PI) / 2, widthM / 2);
  return { west: west.lng, south: south.lat, east: east.lng, north: north.lat };
}

export function transformEntity(entity: Entity): Omit<EntityData, "activeSectors"> | null {
  const drawnEntity = isDrawn(entity);
  const drawn = readDrawing(entity);
  const anchored = drawn?.points.some((point) => point.type === "entity") ?? false;
  // a ring set is labelled ring by ring, and only a path carries labels
  const labelledByPath = drawn?.rings !== undefined;
  // a range draws its own line and labels, and an anchored shape has to be
  // rebuilt from wherever its anchor is now, so neither draws as a plain shape
  const drawsOnlyAsPath =
    drawn?.kind === "range" || drawn?.kind === "freeform" || anchored || labelledByPath;
  const pathPoints = drawn?.points;
  const pathKind = pathPoints ? drawn?.kind : undefined;
  const pathRings = pathPoints ? drawn?.rings : undefined;
  const pathRadiusM = pathPoints ? drawn?.radiusM : undefined;
  const shape = drawsOnlyAsPath || (drawnEntity && !drawn) ? undefined : extractShape(entity);
  const hasPosition = hasGeo(entity);
  const layerComponent = entity.mapLayer;
  let mapLayer: EntityData["mapLayer"];
  if (layerComponent?.source.case === "tiles") {
    mapLayer = {
      kind: "tiles",
      url: layerComponent.source.value.url,
      opacity: 1,
      zIndex: layerComponent.zIndex || undefined,
    };
  } else if (layerComponent?.source.case === "image" && entity.geo) {
    const img = layerComponent.source.value;
    if (img.widthM > 0 && img.heightM > 0) {
      const center: GeoPosition = { lat: entity.geo.latitude, lng: entity.geo.longitude };
      mapLayer = {
        kind: "image",
        url: img.url,
        opacity: 1,
        zIndex: layerComponent.zIndex || undefined,
        ...imageBbox(center, img.widthM, img.heightM),
      };
    }
  }

  if (!hasPosition && !shape && !mapLayer && !pathPoints) return null;

  let position: GeoPosition | undefined;
  if (hasPosition) {
    position = {
      lat: entity.geo.latitude,
      lng: entity.geo.longitude,
      alt: entity.geo.altitude,
    };
  } else if (shape) {
    const pos = shapeCentroid(shape);
    if (!pos) return null;
    position = pos;
  }

  const coverageIds = entity.sensor?.coverage;
  const velocityUp = entity.kinematics?.velocityEnu?.up;

  const parentId = entity.pose?.parent;
  const assemblyParentId = entity.assembly?.parent;
  const assemblyOutlineIds = entity.assembly?.outline;

  return {
    id: entity.id,
    position,
    velocityEnu: velocityUp === undefined ? undefined : { up: velocityUp },
    shape,
    symbol: entity.symbol?.milStd2525C,
    label: entity.label || undefined,
    affiliation: getAffiliation(entity),
    ellipseRadius: hasEllipse(entity) ? 250 : undefined,
    trackHistoryId: entity.track?.history,
    trackPredictionId: entity.track?.prediction,
    pathPoints,
    pathKind,
    pathRings,
    pathRadiusM,
    coverageEntityIds: coverageIds?.length ? coverageIds : undefined,
    parentEntityId: parentId || undefined,
    assemblyParentId: assemblyParentId || undefined,
    assemblyOutlineIds: assemblyOutlineIds?.length ? assemblyOutlineIds : undefined,
    isDetection: entity.detection != null ? true : undefined,
    isDrawn: drawnEntity ? true : undefined,
    mapLayer,
    health: deriveConnectorHealth(entity),
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
let accumulatedLocal = false;
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
    if (change.local) accumulatedLocal = true;
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

    result = { version, geoChanged, entities: changed, removed, local: accumulatedLocal };
  }

  accumulatedLocal = false;
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
      local: delta.local,
    };
  }
}

export function resetDeltaState(): void {
  isFirstBuild = true;
  accumulatedUpdatedIds.clear();
  accumulatedDeletedIds.clear();
  accumulatedGeoChanged = false;
  accumulatedFullClear = false;
  accumulatedLocal = false;
  cachedDelta = null;
  cachedVersion = -1;
}
