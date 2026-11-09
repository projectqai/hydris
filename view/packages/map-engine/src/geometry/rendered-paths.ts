import { isCentreAndRadius, moveEditPoint } from "../geometry/path-geometry";
import type { EditKind, EntityData, GeoPosition, PathPoint } from "../types";
import { geodesicDistance } from "../utils/geodesy";

// Anything the map draws as points joined by lines: a range and bearing, a
// drawing being placed, or the working copy of one being edited.
export type MapPath = {
  id: string;
  kind: EditKind;
  points: PathPoint[];
  // set only on a path already pushed, whose entity has not streamed back yet
  savedAs?: string;
  rings?: number;
  // authoritative once a centre-and-radius shape has been placed or read;
  // absent while its edge handle defines a new radius
  radiusM?: number;
};

export type DragOverride = {
  pathId: string;
  sourceIndex: number;
  point: PathPoint;
};

function resolvePoint(
  point: PathPoint | undefined,
  anchorPositions: ReadonlyMap<string, GeoPosition>,
): GeoPosition | undefined {
  if (!point) return undefined;
  return point.type === "coordinate"
    ? point.position
    : (anchorPositions.get(point.entityId) ?? point.lastKnownPosition);
}

export function capturePathRadius<T extends MapPath>(
  path: T,
  anchorPositions: ReadonlyMap<string, GeoPosition>,
): T & { radiusM?: number } {
  if (!isCentreAndRadius(path.kind)) return path;

  const [centreVertex, edgeVertex] = path.points;
  const centre = resolvePoint(centreVertex, anchorPositions);
  const edge = resolvePoint(edgeVertex, anchorPositions);
  if (!centre || !edge) return path;

  const points: PathPoint[] = [
    centreVertex?.type === "entity"
      ? { ...centreVertex, lastKnownPosition: centre }
      : { type: "coordinate", position: centre },
    { type: "coordinate", position: edge },
  ];
  return {
    ...path,
    points,
    radiusM: geodesicDistance(
      { latitude: centre.lat, longitude: centre.lng },
      { latitude: edge.lat, longitude: edge.lng },
    ),
  };
}

export function movePathVertex<T extends MapPath>(
  path: T,
  index: number,
  point: PathPoint,
  // an anchored centre sits wherever its entity is now, and the handle was
  // dragged against that, not against the position the shape was drawn at
  anchorPositions: ReadonlyMap<string, GeoPosition> = new Map(),
): T {
  const moved = {
    ...path,
    points: moveEditPoint(path.points, index, point, path.kind, path.radiusM),
  };
  if (!isCentreAndRadius(path.kind) || index !== 1) return moved;

  // The edge handle has just defined a new radius. Leaving it unset would send
  // the next centre move back to measuring this edge against a stale snapshot.
  const centre = resolvePoint(moved.points[0], anchorPositions);
  const edge = resolvePoint(moved.points[1], anchorPositions);
  if (!centre || !edge) {
    delete moved.radiusM;
    return moved;
  }
  return {
    ...moved,
    radiusM: geodesicDistance(
      { latitude: centre.lat, longitude: centre.lng },
      { latitude: edge.lat, longitude: edge.lng },
    ),
  };
}

export function vertexMatches(
  vertex: PathPoint | undefined,
  point: PathPoint | undefined,
): boolean {
  if (!vertex || !point) return false;
  if (vertex.type === "entity" || point.type === "entity") {
    return (
      vertex.type === "entity" && point.type === "entity" && vertex.entityId === point.entityId
    );
  }
  return vertex.position.lat === point.position.lat && vertex.position.lng === point.position.lng;
}

// the entity map arrives on a throttled bridge, so a drag preview has to outlive
// the push. landed means the stored vertex agrees with what was sent
export function hasDragLanded(
  entities: ReadonlyMap<string, EntityData>,
  override: DragOverride | null,
): boolean {
  if (!override) return false;
  return vertexMatches(
    entities.get(override.pathId)?.pathPoints?.[override.sourceIndex],
    override.point,
  );
}

export function reconcileEditDragOverride(
  local: readonly MapPath[],
  editingId: string | null,
  override: DragOverride | null,
  previousEditingId: string | null = null,
): DragOverride | null {
  if (override?.pathId === previousEditingId && editingId !== previousEditingId) return null;
  if (!override || override.pathId !== editingId) return override;
  const workingCopy = local.find((path) => path.id === editingId);
  return vertexMatches(workingCopy?.points[override.sourceIndex], override.point) ? override : null;
}

// an entity being edited is skipped, because the working copy stands in for it
// and the two would draw on top of each other. a pushed path renders alongside
// its entity until the local copy is dropped: both draw the same geometry in
// the same place, so an overlap is invisible where a gap is not.
export function collectRenderedPaths({
  entities,
  local,
  editingId,
  dragOverride,
}: {
  entities: ReadonlyMap<string, EntityData>;
  local: readonly MapPath[];
  editingId: string | null;
  dragOverride: DragOverride | null;
}): MapPath[] {
  const stored: MapPath[] = [];
  for (const entity of entities.values()) {
    if (entity.pathPoints && entity.id !== editingId) {
      stored.push({
        id: entity.id,
        kind: entity.pathKind ?? "range",
        points: entity.pathPoints,
        ...(entity.pathRings === undefined ? {} : { rings: entity.pathRings }),
        ...(entity.pathRadiusM === undefined ? {} : { radiusM: entity.pathRadiusM }),
      });
    }
  }

  const paths = [...stored, ...local];

  if (!dragOverride) return paths;
  return paths.map((path) =>
    path.id === dragOverride.pathId
      ? movePathVertex(
          path,
          dragOverride.sourceIndex,
          dragOverride.point,
          livePositions(entities, [...path.points, dragOverride.point]),
        )
      : path,
  );
}

export function livePositions(
  entities: ReadonlyMap<string, EntityData>,
  points: readonly PathPoint[],
): ReadonlyMap<string, GeoPosition> {
  const positions = new Map<string, GeoPosition>();
  for (const point of points) {
    if (point.type !== "entity") continue;
    const position = entities.get(point.entityId)?.position;
    if (position) positions.set(point.entityId, position);
  }
  return positions;
}
