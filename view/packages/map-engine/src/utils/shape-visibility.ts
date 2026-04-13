import type { Affiliation, EntityData, EntityFilter } from "../types";

export type ShapeVisibilityContext = {
  coverageShapeIds: Set<string>;
  filter: EntityFilter;
  selectedId: string | null;
  selectedTrackShapeIds: Set<string>;
  entityMap: Map<string, EntityData>;
  detectionsVisible: boolean;
  trackHistoryVisible: boolean;
  shapesVisible: boolean;
};

export function isShapeVisible(
  shapeId: string,
  affiliation: Affiliation,
  ctx: ShapeVisibilityContext,
): boolean {
  if (ctx.coverageShapeIds.has(shapeId)) return false;
  if (!ctx.filter.tracks[affiliation]) return false;
  if (shapeId === ctx.selectedId) return true;

  const entity = ctx.entityMap.get(shapeId);
  if (entity?.isDetection) return ctx.detectionsVisible;
  if (!entity?.label) {
    return ctx.trackHistoryVisible || ctx.selectedTrackShapeIds.has(shapeId);
  }
  return ctx.shapesVisible;
}
