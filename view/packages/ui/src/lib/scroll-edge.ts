export type ScrollEdge = "start" | "end";

export type ScrollEdgeVisibility = "auto" | ScrollEdge | "both";

type ScrollMetrics = { offset: number; viewport: number; content: number };

// layout sizes are fractional, so a list scrolled to its end can still be a subpixel short
const HIDDEN_THRESHOLD = 1;

export function edgeOpacity(
  edge: ScrollEdge,
  visibility: ScrollEdgeVisibility,
  { offset, viewport, content }: ScrollMetrics,
  fadeDistance: number,
): number {
  "worklet";

  if (visibility === "both") return 1;

  if (visibility !== "auto") return visibility === edge ? 1 : 0;

  const hidden = edge === "start" ? offset : content - viewport - offset;

  return Math.min(Math.max((hidden - HIDDEN_THRESHOLD) / fadeDistance, 0), 1);
}
