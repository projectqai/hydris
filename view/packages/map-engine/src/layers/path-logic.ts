import { ICON_SIZE, RB_MIN_EXTENT_PX } from "../constants";
import type { EditKind, GeoPosition } from "../types";
import { destination } from "../utils/geodesic-circle";
import {
  densifyGeodesicPieces,
  densifyGeodesicRing,
  type GeodesicViewport,
} from "../utils/geodesic-path";

export type PathVertex = {
  pathId: string;
  position: GeoPosition;
  sourceIndex: number;
  anchored: boolean;
  unresolved: boolean;
  entityId?: string;
};

export type PathSegment = {
  pathId: string;
  source: GeoPosition;
  target: GeoPosition;
  sourceIndex: number;
  sourceAnchored: boolean;
  targetAnchored: boolean;
  groundDistanceM: number;
  position: GeoPosition;
  label: string;
  bearingDegrees: number;
  labelBearingDegrees?: number;
  unresolved: boolean;
};

export type PathSegmentLabel = PathSegment & {
  angleDegrees: number;
};

export type PathLineSegment = PathSegment & {
  path: GeoPosition[];
};

type PathTotal = {
  position: GeoPosition;
  label: string;
};

export type PreparedPathTotal = {
  pathId: string;
  total: PathTotal;
  pixelOffset: [number, number];
};

type PathFill = {
  pathId: string;
  ring: GeoPosition[];
};

export type LayerPath = {
  id: string;
  kind: EditKind;
  vertices: PathVertex[];
  segments: PathSegment[];
  // readouts placed at a point rather than along a segment: a ring's total,
  // or one per ring on a set of them
  totals: PathTotal[];
  closed: boolean;
  closable?: boolean;
  endsByGesture?: boolean;
  drawsAsPath?: boolean;
  verticesWhenLocked: boolean;
  pointsAreOutline?: boolean;
  rings?: number;
  anchors?: boolean;
};

export type PathLayerData = {
  paths: LayerPath[];
  drawingId: string | null;
};

export type PathProjector = {
  project: (position: [number, number]) => { x: number; y: number } | undefined;
};

export const FREE_VERTEX_RADIUS = 5;
export const ANCHORED_VERTEX_RADIUS = ICON_SIZE / 2 + 6;
export const LABEL_BACKGROUND_PADDING: [number, number] = [5, 3];
export const TOTAL_LABEL_FONT_SIZE = 14;
export const SEGMENT_LABEL_FONT_SIZE = 12;
const LABEL_CHAR_WIDTH_RATIO = 0.6;
const LABEL_COLLISION_CLEARANCE = 4;
const TOTAL_LABEL_GAP = 3;
const LINE_CLEARANCE = 8;
const ANCHORED_LINE_CLEARANCE = ANCHORED_VERTEX_RADIUS + LINE_CLEARANCE;
const SEGMENT_LABEL_MIN_LENGTH_PX = 140;
const TOTAL_LABEL_HALF_HEIGHT = TOTAL_LABEL_FONT_SIZE / 2 + LABEL_BACKGROUND_PADDING[1];

export function findDrawnPathVertex(
  data: PathLayerData | null,
  projector: PathProjector | null,
  point: { x: number; y: number },
  pathId?: string | null,
) {
  const paths =
    pathId === undefined ? data?.paths : data?.paths.filter((path) => path.id === pathId);
  const vertices = paths?.flatMap((path) => path.vertices);
  return vertices?.find((vertex) => {
    const center = projector?.project([vertex.position.lng, vertex.position.lat]);
    if (!center) return false;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const radius = vertex.anchored ? ANCHORED_VERTEX_RADIUS : FREE_VERTEX_RADIUS;
    return dx * dx + dy * dy <= radius * radius;
  });
}

export function labelAngle(bearingDegrees: number): number {
  // Vertical text reads bottom-to-top regardless of endpoint order.
  return 90 - (bearingDegrees % 180);
}

// only anchored vertices trim the line back, so only they can outrun it and float unconnected
function shouldSuppressPathVertex(vertex: PathVertex, segmentLengthPx: number): boolean {
  return vertex.anchored && segmentLengthPx <= 2 * ANCHORED_LINE_CLEARANCE;
}

export function isPathLegible(path: LayerPath, metersPerPx: number | null): boolean {
  if (metersPerPx === null || metersPerPx <= 0) return true;
  const totalM = path.segments.reduce((sum, segment) => sum + segment.groundDistanceM, 0);
  return totalM / metersPerPx >= RB_MIN_EXTENT_PX;
}

function preparePath(
  path: LayerPath,
  metersPerPx: number | null,
  zoom?: number,
  viewport?: GeodesicViewport,
) {
  const { id: pathId, vertices, segments } = path;
  const hasGroundScale = metersPerPx !== null && metersPerPx > 0;
  const verticesBySourceIndex = new Map(vertices.map((vertex) => [vertex.sourceIndex, vertex]));
  const suppressedVertexKeys = new Set<string>();

  if (hasGroundScale) {
    for (const segment of segments) {
      const segmentLengthPx = segment.groundDistanceM / metersPerPx;
      const sourceVertex = verticesBySourceIndex.get(segment.sourceIndex);
      if (sourceVertex && shouldSuppressPathVertex(sourceVertex, segmentLengthPx)) {
        suppressedVertexKeys.add(`${pathId}:${sourceVertex.sourceIndex}`);
      }

      const targetVertex = verticesBySourceIndex.get(segment.sourceIndex + 1);
      if (targetVertex && shouldSuppressPathVertex(targetVertex, segmentLengthPx)) {
        suppressedVertexKeys.add(`${pathId}:${targetVertex.sourceIndex}`);
      }
    }
  }

  // joining up points that already sit on the outline strokes those edges twice,
  // at two different widths
  const lineSegments: PathLineSegment[] = path.pointsAreOutline
    ? []
    : segments.flatMap((segment) => {
        const sourceTrimM =
          hasGroundScale &&
          segment.sourceAnchored &&
          !suppressedVertexKeys.has(`${pathId}:${segment.sourceIndex}`)
            ? ANCHORED_LINE_CLEARANCE * metersPerPx
            : 0;
        const targetTrimM =
          hasGroundScale &&
          segment.targetAnchored &&
          !suppressedVertexKeys.has(`${pathId}:${segment.sourceIndex + 1}`)
            ? ANCHORED_LINE_CLEARANCE * metersPerPx
            : 0;
        if (hasGroundScale && segment.groundDistanceM <= sourceTrimM + targetTrimM) return [];

        const bearingRad = (segment.bearingDegrees * Math.PI) / 180;
        const source =
          sourceTrimM > 0 ? destination(segment.source, bearingRad, sourceTrimM) : segment.source;
        const target =
          targetTrimM > 0
            ? destination(segment.source, bearingRad, segment.groundDistanceM - targetTrimM)
            : segment.target;
        const pieces =
          zoom === undefined
            ? densifyGeodesicPieces(source, target)
            : densifyGeodesicPieces(
                segment.source,
                segment.target,
                zoom,
                {
                  source,
                  target,
                  startM: sourceTrimM,
                  endM: targetTrimM > 0 ? segment.groundDistanceM - targetTrimM : Infinity,
                },
                viewport,
              );
        return pieces.map((piece) => ({ ...segment, source, target, path: piece }));
      });
  const segmentLabels: PathSegmentLabel[] = segments
    .filter(
      (segment) =>
        path.rings === undefined &&
        (!hasGroundScale || segment.groundDistanceM / metersPerPx >= SEGMENT_LABEL_MIN_LENGTH_PX),
    )
    .map((segment) => ({
      ...segment,
      angleDegrees: labelAngle(segment.labelBearingDegrees ?? segment.bearingDegrees),
    }));
  const totalVertex = vertices.at(-1);
  const totalVertexRadius = totalVertex?.anchored ? ANCHORED_VERTEX_RADIUS : FREE_VERTEX_RADIUS;
  // a ring's total sits inside it, with no vertex to clear
  const totalPixelOffset: [number, number] =
    path.closed || path.rings !== undefined
      ? [0, 0]
      : [0, -(totalVertexRadius + TOTAL_LABEL_GAP + TOTAL_LABEL_HALF_HEIGHT)];

  return {
    vertices,
    lineSegments,
    segmentLabels,
    fills: path.closed
      ? densifyGeodesicRing(
          vertices.map((vertex) => vertex.position),
          zoom,
          viewport,
        ).map((ring): PathFill => ({ pathId, ring }))
      : [],
    totals: path.totals.map((total) => ({ pathId: path.id, total, pixelOffset: totalPixelOffset })),
    suppressedVertexKeys,
  };
}

type LabelBox = { x: number; y: number; halfWidth: number; halfHeight: number };

function labelBox(
  center: { x: number; y: number },
  text: string,
  fontSize: number,
  angleDegrees: number,
): LabelBox {
  const width = text.length * fontSize * LABEL_CHAR_WIDTH_RATIO + 2 * LABEL_BACKGROUND_PADDING[0];
  const height = fontSize + 2 * LABEL_BACKGROUND_PADDING[1];
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    x: center.x,
    y: center.y,
    halfWidth: (width * cos + height * sin) / 2 + LABEL_COLLISION_CLEARANCE,
    halfHeight: (width * sin + height * cos) / 2 + LABEL_COLLISION_CLEARANCE,
  };
}

function projectLabelBox(
  projector: PathProjector,
  position: GeoPosition,
  text: string,
  fontSize: number,
  angleDegrees: number,
  pixelOffset: [number, number] = [0, 0],
): LabelBox | null {
  const center = projector.project([position.lng, position.lat]);
  if (!center) return null;
  return labelBox(
    { x: center.x + pixelOffset[0], y: center.y + pixelOffset[1] },
    text,
    fontSize,
    angleDegrees,
  );
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth &&
    Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight
  );
}

type PathLabels = {
  segmentLabels: PathSegmentLabel[];
  totals: PreparedPathTotal[];
};

function resolveLabelCollisions(paths: PathLabels[], projector: PathProjector | null) {
  if (!projector) {
    return {
      segmentLabels: paths.flatMap((path) => path.segmentLabels),
      totals: paths.flatMap((path) => path.totals),
    };
  }

  const kept: LabelBox[] = [];
  const totals: PreparedPathTotal[] = [];
  for (const total of paths.flatMap((path) => path.totals)) {
    const box = projectLabelBox(
      projector,
      total.total.position,
      total.total.label,
      TOTAL_LABEL_FONT_SIZE,
      0,
      total.pixelOffset,
    );
    if (box) {
      if (kept.some((current) => boxesOverlap(current, box))) continue;
      kept.push(box);
    }
    totals.push(total);
  }

  // Only the label that collides is dropped. Losing a whole ring's readouts
  // because two of its sides crowd each other reads as broken.
  const segmentLabels: PathSegmentLabel[] = [];
  for (const path of paths) {
    for (const label of path.segmentLabels) {
      const box = projectLabelBox(
        projector,
        label.position,
        label.label,
        SEGMENT_LABEL_FONT_SIZE,
        label.angleDegrees,
      );
      if (box) {
        if (kept.some((current) => boxesOverlap(current, box))) continue;
        kept.push(box);
      }
      segmentLabels.push(label);
    }
  }

  return { segmentLabels, totals };
}

export function preparePathLayerData(
  data: PathLayerData | null,
  metersPerPx: number | null,
  projector: PathProjector | null = null,
  zoom?: number,
  viewport?: GeodesicViewport,
) {
  const prepared = data?.paths.map((path) => preparePath(path, metersPerPx, zoom, viewport)) ?? [];

  const { segmentLabels, totals } = resolveLabelCollisions(prepared, projector);

  return {
    vertices: prepared.flatMap((path) => path.vertices),
    lineSegments: prepared.flatMap((path) => path.lineSegments),
    segmentLabels,
    fills: prepared.flatMap((path) => path.fills),
    totals,
    suppressedVertexKeys: new Set(prepared.flatMap((path) => [...path.suppressedVertexKeys])),
  };
}

export function downgradeHiddenPathAnchors(
  data: PathLayerData | null,
  renderedEntityIds: ReadonlySet<string>,
): PathLayerData | null {
  const hiddenAnchorKeys = new Set(
    data?.paths.flatMap((path) =>
      path.vertices.flatMap((vertex) =>
        vertex.anchored &&
        !vertex.unresolved &&
        vertex.entityId !== undefined &&
        !renderedEntityIds.has(vertex.entityId)
          ? [`${path.id}:${vertex.sourceIndex}`]
          : [],
      ),
    ) ?? [],
  );
  if (!data || hiddenAnchorKeys.size === 0) return data;

  return {
    ...data,
    paths: data.paths.map((path) => ({
      ...path,
      vertices: path.vertices.map((vertex) =>
        hiddenAnchorKeys.has(`${path.id}:${vertex.sourceIndex}`)
          ? { ...vertex, anchored: false }
          : vertex,
      ),
      segments: path.segments.map((segment) => ({
        ...segment,
        sourceAnchored:
          segment.sourceAnchored && !hiddenAnchorKeys.has(`${path.id}:${segment.sourceIndex}`),
        targetAnchored:
          segment.targetAnchored && !hiddenAnchorKeys.has(`${path.id}:${segment.sourceIndex + 1}`),
      })),
    })),
  };
}
