import type { LayerPath, PathLayerData, PathVertex } from "../../layers/path-logic";
import type { GeoPosition, PathPoint } from "../../types";

export type ActiveTool = "none" | "bullseye" | "range" | "drawing";

export const MAP_CENTER = { x: 0.5, y: 0.5 } as const;

export const PATH_VERTEX_PICK_RADIUS = 8;
// A larger touch radius matches a fingertip. Vertices closer together than this
// are picked by whichever the renderer returns first.
const PATH_VERTEX_PICK_RADIUS_TOUCH = 20;

export function vertexPickRadius(isTouch: boolean): number {
  return isTouch ? PATH_VERTEX_PICK_RADIUS_TOUCH : PATH_VERTEX_PICK_RADIUS;
}

export function shouldFinishOnDoubleClick(
  pointerType: string | null,
  endsByGesture: boolean,
  hasEditablePath: boolean,
): boolean {
  return pointerType !== "touch" && (endsByGesture || hasEditablePath);
}

// A press that slides past maplibre's clickTolerance pans instead of clicking,
// and maplibre suppresses the trailing click, so a hurried placement is lost.
// Short and near means it was meant as a click.
const SLIPPED_CLICK_MAX_MS = 250;
const SLIPPED_CLICK_MAX_PX = 30;

// A click just after one that selected something is the tail of that gesture,
// not a deselect.
const SELECTION_TAIL_MS = 500;

type MapClickDecision = "ignore" | "commit-range" | "commit-placement" | "clear-selection";

export type MapClickInput = {
  activeTool: ActiveTool;
  isDragging: boolean;
  isAnimating: boolean;
  hasCoordinate: boolean;
  picked: boolean;
  msSinceLayerClick: number;
};

export function resolveEntityLayerClick(
  activeTool: ActiveTool,
  anchors: boolean,
  target: "entity" | "cluster",
): "refuse" | "anchor" | "select" | "place" | "fly" {
  if (activeTool === "none") return target === "entity" ? "select" : "fly";
  if (!anchors) return "refuse";
  return target === "entity" ? "anchor" : "place";
}

export type MapCursorInput = {
  activeTool: ActiveTool;
  editablePathId: string | null;
  anchors: boolean;
  picked: boolean;
  pickedAnchorableEntity: boolean;
  pickedPathVertex: boolean;
  dragging: boolean;
};

export function resolveMapCursor({
  activeTool,
  editablePathId,
  anchors,
  picked,
  pickedAnchorableEntity,
  pickedPathVertex,
  dragging,
}: MapCursorInput): "crosshair" | "pointer" | "grab" | "grabbing" {
  if (dragging) return "grabbing";
  if (pickedPathVertex) return "grab";
  if (activeTool !== "none") {
    return anchors && pickedAnchorableEntity ? "pointer" : "crosshair";
  }
  if (editablePathId !== null) {
    return anchors && pickedAnchorableEntity ? "pointer" : "grab";
  }
  return picked ? "pointer" : "grab";
}

// a claimed tap never reaches the map's click route, so this owns its commit
export function resolveClaimedVertexTap(activeTool: ActiveTool): "commit-range" | "handle-vertex" {
  return activeTool === "range" ? "commit-range" : "handle-vertex";
}

// What a click on the map means. The order of the guards is the logic, which is
// why it is a function a test can reach rather than early returns in a handler.
export function resolveMapClick({
  activeTool,
  isDragging,
  isAnimating,
  hasCoordinate,
  picked,
  msSinceLayerClick,
}: MapClickInput): MapClickDecision {
  // a range resolves what is under the pointer, so it answers before the drag
  // guard rather than after it
  if (activeTool === "range") return "commit-range";
  if (isDragging) return "ignore";
  // placing a point is deliberate, so it is answered before the guards that
  // exist to protect a selection
  if (activeTool !== "none" && hasCoordinate) return "commit-placement";
  if (isAnimating) return "ignore";
  if (msSinceLayerClick < SELECTION_TAIL_MS) return "ignore";
  return picked ? "ignore" : "clear-selection";
}

export function isSlippedClick(elapsedMs: number, slidePx: number): boolean {
  return elapsedMs <= SLIPPED_CLICK_MAX_MS && slidePx <= SLIPPED_CLICK_MAX_PX;
}

// the path being placed. branch on its flags rather than on which tool is
// armed, or each tool grows its own behaviour
export function findPlacingPath(data: PathLayerData | null): LayerPath | null {
  return data?.paths.find((path) => path.id === data.drawingId) ?? null;
}

// Taken by id rather than read off the placing path, because an edit has no
// path being placed.
export function pathAnchors(data: PathLayerData | null, pathId: string): boolean {
  return data?.paths.find((path) => path.id === pathId)?.anchors ?? false;
}

// Tapping the first vertex of a closable path closes it into a ring. Anything
// else, including its other vertices, is an ordinary point.
export function closingVertexOf(
  path: LayerPath | null,
  picked: PathVertexTarget | null,
): PathVertex | null {
  if (!path?.closable || picked?.pathId !== path.id || picked.sourceIndex !== 0) return null;
  return path.vertices[0] ?? null;
}

// A finished shape is locked. Only what is being placed, or what was explicitly
// opened for editing, gives up a vertex to a drag.
export function isVertexUnlocked(
  target: PathVertexTarget | null,
  editablePathId: string | null,
  placingId: string | null,
): boolean {
  if (!target) return false;
  return target.pathId === editablePathId || target.pathId === placingId;
}

type RangeMapCommit = { type: "point"; point: PathPoint };

export type PathVertexTarget = Pick<PathVertex, "pathId" | "sourceIndex">;

export function findPickedEntityId(objects: readonly unknown[]): string | null {
  for (const object of objects) {
    const target = object as { entityId?: unknown; entity?: { id?: unknown } } | null;
    if (typeof target?.entityId === "string") return target.entityId;
    if (typeof target?.entity?.id === "string") return target.entity.id;
  }
  return null;
}

export function findPickedPathId(object: unknown): string | null {
  const target = object as { pathId?: unknown } | null;
  return typeof target?.pathId === "string" ? target.pathId : null;
}

// A shape feature carries its entity under properties.id, not the entityId that
// findPickedEntityId looks for, so a drawn shape needs its own reader.
export function findPickedShapeId(object: unknown): string | null {
  const target = object as { properties?: { id?: unknown } } | null;
  return typeof target?.properties?.id === "string" ? target.properties.id : null;
}

export function findPickedPathVertexTarget(object: unknown): PathVertexTarget | null {
  const target = object as { pathId?: unknown; sourceIndex?: unknown } | null;
  return typeof target?.pathId === "string" && typeof target.sourceIndex === "number"
    ? { pathId: target.pathId, sourceIndex: target.sourceIndex }
    : null;
}

export function resolveRangeMapCommit({
  point,
  pickedPathVertex,
  drawnPathVertex,
  pickEntityId,
  coordinateForPoint,
}: {
  point: { x: number; y: number };
  pickedPathVertex: PathVertexTarget | null;
  drawnPathVertex: PathVertexTarget | null;
  pickEntityId: (x: number, y: number) => string | null;
  coordinateForPoint: () => GeoPosition | undefined;
}): RangeMapCommit | null {
  if (pickedPathVertex || drawnPathVertex) return null;

  const entityId = pickEntityId(point.x, point.y);
  if (entityId) return { type: "point", point: { type: "entity", entityId } };

  const position = coordinateForPoint();
  return position ? { type: "point", point: { type: "coordinate", position } } : null;
}
