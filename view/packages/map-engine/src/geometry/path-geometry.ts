import type { EditKind, GeoPosition, PathPoint } from "../types";
import { destinationDegrees } from "../utils/geodesic-circle";
import { geodesicMidpoint } from "../utils/geodesic-path";
import {
  ellipsoidPolygonArea,
  geodesicDistance,
  initialBearing,
  slantRangeAndElevation,
} from "../utils/geodesy";
import { rectangleCorners } from "./rectangle";

type DerivedSegment = {
  groundDistanceM: number;
  slantDistanceM: number | null;
  bearingDegrees: number;
  elevationAngleDegrees: number | null;
};

export type DerivedPath = {
  positions: Array<GeoPosition | null>;
  segments: Array<DerivedSegment | null>;
  totalGroundDistanceM: number | null;
  totalSlantDistanceM: number | null;
  areaM2: number | null;
  unresolvedEntityIds: string[];
};

function samePosition(a: GeoPosition | undefined, b: GeoPosition | undefined): boolean {
  return !!a && !!b && a.lat === b.lat && a.lng === b.lng;
}

// A ring closes by repeating its first point, which is the only thing that
// separates an enclosed area from an open line.
export function closesRing(positions: readonly GeoPosition[]): boolean {
  return positions.length >= 3 && samePosition(positions[0], positions.at(-1));
}

function pointsCoincide(first: PathPoint, last: PathPoint): boolean {
  // two anchors close a ring by being the same anchor. their snapshots agreeing
  // would only mean two entities were in the same place at one moment.
  if (first.type === "entity" && last.type === "entity") return first.entityId === last.entityId;
  const firstPosition = first.type === "coordinate" ? first.position : first.lastKnownPosition;
  const lastPosition = last.type === "coordinate" ? last.position : last.lastKnownPosition;
  return samePosition(firstPosition, lastPosition);
}

function isPathClosed(points: readonly PathPoint[]): boolean {
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  return (
    points.length >= 3 &&
    firstPoint !== undefined &&
    lastPoint !== undefined &&
    pointsCoincide(firstPoint, lastPoint)
  );
}

type GeodesicSegment = {
  source: GeoPosition;
  target: GeoPosition;
  groundDistanceM: number;
};

function distanceBetween(a: GeoPosition, b: GeoPosition): number {
  return geodesicDistance(
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
  );
}

function segmentsCross(first: GeodesicSegment, second: GeodesicSegment): boolean {
  let remaining = 256;
  const mayCross = (a: GeodesicSegment, b: GeodesicSegment): boolean => {
    const lengthM = a.groundDistanceM + b.groundDistanceM;
    if (!Number.isFinite(lengthM)) return true;
    // At a crossing, the triangle inequality bounds either pairing of endpoint
    // distances by the sum of the edge lengths. A micrometre covers roundoff.
    if (
      distanceBetween(a.source, b.source) + distanceBetween(a.target, b.target) > lengthM + 1e-6 ||
      distanceBetween(a.source, b.target) + distanceBetween(a.target, b.source) > lengthM + 1e-6
    ) {
      return false;
    }
    // Unresolved contact within a millimetre, or exhausted work, withholds area.
    if (lengthM <= 0.001 || remaining-- === 0) return true;
    const longer = a.groundDistanceM >= b.groundDistanceM ? a : b;
    const shorter = longer === a ? b : a;
    const midpoint = geodesicMidpoint(longer.source, longer.target);
    const halfLengthM = longer.groundDistanceM / 2;
    return (
      mayCross(
        { source: longer.source, target: midpoint, groundDistanceM: halfLengthM },
        shorter,
      ) ||
      mayCross({ source: midpoint, target: longer.target, groundDistanceM: halfLengthM }, shorter)
    );
  };
  return mayCross(first, second);
}

// An outline that crosses itself encloses two halves running opposite ways, so
// they subtract rather than add. The result is not the region either half
// covers, and only cancels to near zero when the halves happen to match.
// Callers report no area rather than a number describing neither.
function ringFoldsOverItself(ring: readonly GeoPosition[]): boolean {
  const corners = closesRing(ring) ? ring.slice(0, -1) : ring;
  const segments = corners.flatMap((source, index) => {
    const target = corners[(index + 1) % corners.length];
    return target ? [{ source, target, groundDistanceM: distanceBetween(source, target) }] : [];
  });

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 2; j < segments.length; j += 1) {
      // The first and last segments meet at the closing vertex.
      if (i === 0 && j === segments.length - 1) continue;
      const first = segments[i];
      const second = segments[j];
      if (first && second && segmentsCross(first, second)) return true;
    }
  }
  return false;
}

export function movePathPoint(
  points: readonly PathPoint[],
  index: number,
  point: PathPoint,
): PathPoint[] {
  const lastIndex = points.length - 1;
  const moveClosingPair = isPathClosed(points) && (index === 0 || index === lastIndex);

  return points.map((current, currentIndex) =>
    currentIndex === index ||
    (moveClosingPair && (currentIndex === 0 || currentIndex === lastIndex))
      ? point
      : current,
  );
}

// A rectangle's third handle is the depth tap, whose distance along the first
// edge is discarded. Left alone it slides away from the shape as you drag it, so
// it is pinned back onto the corner it stands for.
function pinRectangleDepth(points: readonly PathPoint[]): PathPoint[] {
  const [first, second, depth] = points;
  if (
    points.length !== 3 ||
    first?.type !== "coordinate" ||
    second?.type !== "coordinate" ||
    depth?.type !== "coordinate"
  ) {
    return [...points];
  }
  const corner = rectangleCorners(first.position, second.position, depth.position)[2];
  return corner ? [first, second, { type: "coordinate", position: corner }] : [...points];
}

export const isCentreAndRadius = (kind: EditKind | null) =>
  kind === "circle" || kind === "rb-circle";

// Dragging the centre moves the whole shape, so the edge handle travels with it.
// Only the edge handle changes the radius.
export function moveEditPoint(
  points: readonly PathPoint[],
  index: number,
  point: PathPoint,
  kind: EditKind | null,
  radiusM?: number,
): PathPoint[] {
  if (kind === "rectangle") return pinRectangleDepth(movePathPoint(points, index, point));

  const [centre, edge] = points;
  if (
    !isCentreAndRadius(kind) ||
    index !== 0 ||
    point.type !== "coordinate" ||
    edge?.type !== "coordinate"
  ) {
    return movePathPoint(points, index, point);
  }

  const centrePosition =
    centre?.type === "coordinate" ? centre.position : centre?.lastKnownPosition;
  if (!centrePosition) return movePathPoint(points, index, point);

  const from = { latitude: centrePosition.lat, longitude: centrePosition.lng };
  const to = { latitude: edge.position.lat, longitude: edge.position.lng };
  const movedEdge = destinationDegrees(
    point.position,
    initialBearing(from, to),
    radiusM ?? geodesicDistance(from, to),
  );
  return [point, { type: "coordinate", position: movedEdge }];
}

// A circle's radius remains authoritative while its anchored centre resolves
// anew, so the edge handle travels with the centre instead of resizing the shape.
function holdRadius(
  kind: EditKind | null,
  radiusM: number | undefined,
  points: readonly PathPoint[],
  positions: (GeoPosition | null)[],
): (GeoPosition | null)[] {
  const centre = points[0];
  if (!isCentreAndRadius(kind) || radiusM === undefined || centre?.type !== "entity") {
    return positions;
  }

  const drawnCentre = centre.lastKnownPosition;
  const drawnEdge = points[1]?.type === "coordinate" ? points[1].position : null;
  const livePosition = positions[0];
  if (!drawnCentre || !drawnEdge || !livePosition) return positions;

  const from = { latitude: drawnCentre.lat, longitude: drawnCentre.lng };
  const to = { latitude: drawnEdge.lat, longitude: drawnEdge.lng };
  const moved = destinationDegrees(livePosition, initialBearing(from, to), radiusM);
  return [livePosition, moved, ...positions.slice(2)];
}

export function derivePath(
  points: readonly PathPoint[],
  anchorPositions: ReadonlyMap<string, GeoPosition>,
  kind: EditKind | null = null,
  radiusM?: number,
): DerivedPath {
  const unresolvedEntityIds: string[] = [];
  const positions = holdRadius(
    kind,
    radiusM,
    points,
    points.map((point) => {
      if (point.type === "coordinate") return point.position;
      const position = anchorPositions.get(point.entityId);
      if (!position) unresolvedEntityIds.push(point.entityId);
      return position ?? point.lastKnownPosition ?? null;
    }),
  );
  const segments: Array<DerivedSegment | null> = [];
  let totalGroundDistanceM = 0;
  let totalSlantDistanceM = 0;
  let hasUnavailableSlant = false;
  for (let i = 1; i < positions.length; i++) {
    const start = positions[i - 1];
    const end = positions[i];
    if (!start || !end) {
      segments.push(null);
      continue;
    }
    const startGeo = { latitude: start.lat, longitude: start.lng };
    const endGeo = { latitude: end.lat, longitude: end.lng };
    const groundDistanceM = geodesicDistance(startGeo, endGeo);
    const threeD =
      start.alt === undefined || end.alt === undefined
        ? null
        : slantRangeAndElevation(
            { ...startGeo, altitude: start.alt },
            { ...endGeo, altitude: end.alt },
          );
    const slantDistanceM = threeD?.slantDistanceM ?? null;
    segments.push({
      groundDistanceM,
      slantDistanceM,
      bearingDegrees: initialBearing(startGeo, endGeo),
      elevationAngleDegrees: threeD?.elevationAngleDegrees ?? null,
    });
    totalGroundDistanceM += groundDistanceM;
    if (slantDistanceM === null) {
      hasUnavailableSlant = true;
    } else {
      totalSlantDistanceM += slantDistanceM;
    }
  }
  const hasUnresolvedVertices = unresolvedEntityIds.length > 0;
  const ring = positions.flatMap((position) => (position ? [position] : []));
  const enclosesArea = !hasUnresolvedVertices && isPathClosed(points) && !ringFoldsOverItself(ring);
  return {
    positions,
    segments,
    totalGroundDistanceM: hasUnresolvedVertices ? null : totalGroundDistanceM,
    totalSlantDistanceM: hasUnresolvedVertices || hasUnavailableSlant ? null : totalSlantDistanceM,
    areaM2: enclosesArea
      ? ellipsoidPolygonArea(
          ring.map((position) => ({ latitude: position.lat, longitude: position.lng })),
        )
      : null,
    unresolvedEntityIds,
  };
}
