import { closesRing, derivePath } from "@hydris/map-engine/geometry/path-geometry";
import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import type { EditKind, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { destinationDegrees } from "@hydris/map-engine/utils/geodesic-circle";
import { geodesicDistance, initialBearing } from "@hydris/map-engine/utils/geodesy";

export const DEFAULT_RINGS = 1;

type ToolSpec = {
  label: string;
  // the segment that goes in the entity id
  idPrefix: string;
  // the fewest points that make a shape worth saving
  minPoints: number;
  // the count that ends placement on its own, null when the tool needs an
  // explicit end or a closed ring instead
  finishesAt: number | null;
  // the shape is the line through its points, so the path layer already draws
  // it and only the leg to the pointer is left to preview
  drawsAsPath: boolean;
  verticesWhenLocked: boolean;
  // a vertex may be dropped onto an entity and follow it
  anchors: boolean;
  // the stored points are corners of the outline the shape layer already draws,
  // so joining them up would stroke those edges a second time
  pointsAreOutline: boolean;
  // draws concentric rings at whole multiples of its radius, so it carries a
  // count rather than a single outline
  rings: boolean;
};

// What each kind of path is, in one place. A new tool fills in a row or the
// build fails, which is the only thing that keeps the tools from drifting.
export const TOOL: Record<EditKind, ToolSpec> = {
  range: {
    label: "R&B",
    idPrefix: "rb",
    minPoints: 2,
    finishesAt: 2,
    drawsAsPath: true,
    verticesWhenLocked: true,
    anchors: true,
    pointsAreOutline: false,
    rings: false,
  },
  freeform: {
    label: "Freeform",
    idPrefix: "freeform",
    minPoints: 2,
    finishesAt: null,
    drawsAsPath: true,
    verticesWhenLocked: false,
    anchors: false,
    pointsAreOutline: false,
    rings: false,
  },
  circle: {
    label: "Circle",
    idPrefix: "circle",
    minPoints: 2,
    finishesAt: 2,
    drawsAsPath: false,
    verticesWhenLocked: false,
    anchors: false,
    pointsAreOutline: false,
    rings: false,
  },
  "rb-circle": {
    label: "R&B Circle",
    idPrefix: "rbcircle",
    minPoints: 2,
    finishesAt: 2,
    drawsAsPath: true,
    verticesWhenLocked: false,
    anchors: false,
    pointsAreOutline: true,
    rings: true,
  },
  rectangle: {
    label: "Rectangle",
    idPrefix: "rectangle",
    minPoints: 3,
    finishesAt: 3,
    drawsAsPath: false,
    verticesWhenLocked: false,
    anchors: false,
    pointsAreOutline: true,
    rings: false,
  },
};

// null when the tool has no fixed count, so a readout shows nothing rather than
// a number
export function pointsRemaining(path: MapPath | undefined): number | null {
  if (!path) return 0;
  const { finishesAt } = TOOL[path.kind];
  return finishesAt === null ? null : finishesAt - path.points.length;
}

export function hasEnoughPoints(path: MapPath): boolean {
  return path.points.length >= TOOL[path.kind].minPoints;
}

// Placement ends on the tool's own point count, or when the path closes a ring,
// which is how a freeform becomes an area.
export function placementEnds(path: MapPath): boolean {
  const { finishesAt } = TOOL[path.kind];
  if (finishesAt !== null) return path.points.length >= finishesAt;
  return closesRing(path.points.flatMap((p) => (p.type === "coordinate" ? [p.position] : [])));
}

export function removePath<T extends MapPath>(paths: T[], pathId: string | null): T[] {
  return paths.filter((path) => path.id !== pathId);
}

export function translatePath(path: MapPath, from: GeoPosition, to: GeoPosition): MapPath {
  if (from.lat === to.lat && from.lng === to.lng) return path;

  const reference = { latitude: from.lat, longitude: from.lng };
  const positions = derivePath(path.points, new Map(), path.kind, path.radiusM).positions;
  const points: PathPoint[] = [];
  for (const position of positions) {
    if (!position) return path;
    const vertex = { latitude: position.lat, longitude: position.lng };
    points.push({
      type: "coordinate",
      position: {
        ...position,
        ...destinationDegrees(
          to,
          initialBearing(reference, vertex),
          geodesicDistance(reference, vertex),
        ),
      },
    });
  }
  return { ...path, points };
}

// The second click of a double-click lands on the same spot as the first, so it
// leaves a duplicate that is not a point the person meant to place.
export function endsOnADuplicate(path: MapPath): boolean {
  const [previous, last] = path.points.slice(-2);
  return (
    previous?.type === "coordinate" &&
    last?.type === "coordinate" &&
    previous.position.lat === last.position.lat &&
    previous.position.lng === last.position.lng
  );
}

// A pushed path is only given up once the map has published its entity. Asking
// the renderer rather than the entity store keeps both copies on one clock, so
// the handover never leaves a frame with neither drawn.
export function arrivedPathIds(
  paths: readonly MapPath[],
  isPublished: (entityId: string) => boolean,
): string[] {
  return paths.flatMap((path) => (path.savedAs && isPublished(path.savedAs) ? [path.id] : []));
}
