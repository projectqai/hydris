import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Feature, Polygon } from "geojson";

import type { BaseLayer, RGBA } from "../types";
import { densifyGeodesicPieces, type GeodesicViewport } from "../utils/geodesic-path";
import {
  ANCHORED_VERTEX_RADIUS,
  FREE_VERTEX_RADIUS,
  LABEL_BACKGROUND_PADDING,
  type PathLayerData,
  type PathLineSegment,
  type PathProjector,
  type PathSegment,
  type PathSegmentLabel,
  type PathVertex,
  type PreparedPathTotal,
  preparePathLayerData,
  SEGMENT_LABEL_FONT_SIZE,
  TOTAL_LABEL_FONT_SIZE,
} from "./path-logic";

export type { PathLayerData } from "./path-logic";

type ColorTheme = {
  fill: RGBA;
  line: RGBA;
  lineUnresolved: RGBA;
  lineCasing: RGBA;
  vertex: RGBA;
  vertexUnresolved: RGBA;
  label: RGBA;
  labelUnresolved: RGBA;
  labelBackground: RGBA;
  labelOutline: RGBA;
};

const THEMES: Record<BaseLayer, ColorTheme> = {
  satellite: {
    fill: [255, 255, 255, 88],
    line: [255, 255, 255, 255],
    lineUnresolved: [255, 255, 255, 80],
    lineCasing: [16, 16, 16, 220],
    vertex: [80, 220, 60, 255],
    vertexUnresolved: [80, 220, 60, 110],
    label: [255, 255, 255, 240],
    labelUnresolved: [255, 255, 255, 120],
    labelBackground: [16, 16, 16, 255],
    labelOutline: [0, 0, 0, 200],
  },
  dark: {
    fill: [80, 140, 255, 46],
    line: [80, 140, 255, 255],
    lineUnresolved: [80, 140, 255, 80],
    lineCasing: [16, 20, 28, 220],
    vertex: [80, 220, 60, 255],
    vertexUnresolved: [80, 220, 60, 110],
    label: [80, 140, 255, 240],
    labelUnresolved: [80, 140, 255, 120],
    labelBackground: [16, 20, 28, 255],
    labelOutline: [0, 0, 0, 200],
  },
  street: {
    fill: [40, 70, 180, 38],
    line: [40, 70, 180, 255],
    lineUnresolved: [40, 70, 180, 80],
    lineCasing: [245, 245, 245, 220],
    vertex: [80, 220, 60, 255],
    vertexUnresolved: [80, 220, 60, 110],
    label: [40, 70, 180, 240],
    labelUnresolved: [40, 70, 180, 120],
    labelBackground: [245, 245, 245, 255],
    labelOutline: [255, 255, 255, 180],
  },
};

export function pathFillColor(baseLayer: BaseLayer): RGBA {
  return THEMES[baseLayer].fill;
}

export function pathLineColor(baseLayer: BaseLayer): RGBA {
  return THEMES[baseLayer].line;
}

export function pathCasingColor(baseLayer: BaseLayer): RGBA {
  return THEMES[baseLayer].lineCasing;
}

const dashExtension = new PathStyleExtension({ dash: true });
const SOLID: [number, number] = [0, 0];
const UNRESOLVED_DASH: [number, number] = [8, 4];
const UNRESOLVED_CASING_DASH: [number, number] = [4, 2];
const UNRESOLVED_VERTEX_DASH: [number, number] = [6, 3];
const UNRESOLVED_VERTEX_CASING_DASH: [number, number] = [3, 1.5];
export const LINE_WIDTH = 1.5;
export const SELECTED_LINE_WIDTH = LINE_WIDTH * 2;
const CASING_WIDTH = 2.5;
export const CASED_LINE_WIDTH = LINE_WIDTH + CASING_WIDTH;
export const SELECTED_CASED_LINE_WIDTH = SELECTED_LINE_WIDTH + CASING_WIDTH;
const TRANSPARENT: RGBA = [0, 0, 0, 0];
const VERTEX_OUTLINE: RGBA = [0, 0, 0, 200];
export const PATH_FILL_LAYER_ID = "range-fills";
export const PATH_VERTEX_LAYER_ID = "range-vertices";
export const PATH_LINE_CASING_LAYER_ID = "range-line-casing";
export const PATH_SEGMENT_LABEL_LAYER_ID = "range-segment-labels";
export const PATH_TOTAL_LABEL_LAYER_ID = "range-total-label";
const ANCHORED_VERTEX_RING_WIDTH = 2;
const RANGE_ENDPOINT_TICK_HALF_LENGTH = 7;
const RANGE_ENDPOINT_TICK_SIZE = RANGE_ENDPOINT_TICK_HALF_LENGTH * 2;
const RANGE_ENDPOINT_TICK_CASING_SIZE = RANGE_ENDPOINT_TICK_SIZE + CASING_WIDTH;
const RANGE_ENDPOINT_TICK_CASING_ICON_SIZE = Math.ceil(RANGE_ENDPOINT_TICK_CASING_SIZE / 2) * 2;

function createRangeEndpointTickIcon(thickness: number, length: number, iconSize: number) {
  const iconCenter = iconSize / 2;
  return {
    url:
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}"><rect x="${iconCenter - length / 2}" y="${iconCenter - thickness / 2}" width="${length}" height="${thickness}" fill="white"/></svg>`,
      ),
    width: iconSize,
    height: iconSize,
    anchorX: iconCenter,
    anchorY: iconCenter,
    mask: true,
  };
}

const RANGE_ENDPOINT_TICK_CASING_ICON = createRangeEndpointTickIcon(
  CASED_LINE_WIDTH,
  RANGE_ENDPOINT_TICK_CASING_SIZE,
  RANGE_ENDPOINT_TICK_CASING_ICON_SIZE,
);
const RANGE_ENDPOINT_TICK_ICON = createRangeEndpointTickIcon(
  LINE_WIDTH,
  RANGE_ENDPOINT_TICK_SIZE,
  RANGE_ENDPOINT_TICK_SIZE,
);
const SELECTED_RANGE_ENDPOINT_TICK_CASING_ICON = createRangeEndpointTickIcon(
  SELECTED_CASED_LINE_WIDTH,
  RANGE_ENDPOINT_TICK_CASING_SIZE,
  RANGE_ENDPOINT_TICK_CASING_ICON_SIZE,
);
const SELECTED_RANGE_ENDPOINT_TICK_ICON = createRangeEndpointTickIcon(
  SELECTED_LINE_WIDTH,
  RANGE_ENDPOINT_TICK_SIZE,
  RANGE_ENDPOINT_TICK_SIZE,
);

type RangeEndpointTick = PathVertex & { angleDegrees: number };

// Green marks a handle you can grab. A finished shape is locked, so its points
// take the line's colour and read as part of the shape instead.
function pathVertexFillColor(vertex: PathVertex, baseLayer: BaseLayer, editable: boolean): RGBA {
  if (vertex.anchored) return TRANSPARENT;
  const theme = THEMES[baseLayer];
  if (!editable) {
    const [r, g, b] = vertex.unresolved ? theme.lineUnresolved : theme.line;
    return [r, g, b, 255];
  }
  return vertex.unresolved ? theme.vertexUnresolved : theme.vertex;
}

export function rangeVertexRingColor(
  vertex: PathVertex,
  baseLayer: BaseLayer,
  editable = true,
): RGBA {
  if (!vertex.anchored) return VERTEX_OUTLINE;
  const theme = THEMES[baseLayer];
  if (!editable) return vertex.unresolved ? theme.lineUnresolved : theme.line;
  return vertex.unresolved ? theme.vertexUnresolved : theme.vertex;
}

function createLabelStyle(theme: ColorTheme) {
  return {
    fontFamily: "Inter, sans-serif",
    fontWeight: "500",
    fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
    // Auto keeps the atlas open, so a new glyph rebuilds it instead of dropping
    // out of a readout.
    characterSet: "auto",
    background: true,
    getBackgroundColor: theme.labelBackground,
    backgroundPadding: LABEL_BACKGROUND_PADDING,
    backgroundBorderRadius: 9,
    outlineWidth: 1,
    outlineColor: theme.labelOutline,
  } as const;
}

export type RangePreview = {
  source: PathVertex["position"];
  target: PathVertex["position"];
  label: string;
};

export function createRangeInteractionLayers({
  preview,
  zoom,
  viewport,
  closingVertex = null,
  pulsePhase = 0,
  baseLayer = "satellite",
}: {
  preview: RangePreview | null;
  zoom?: number;
  viewport?: GeodesicViewport;
  // the vertex the pointer is over that would close the path into a ring
  closingVertex?: PathVertex | null;
  pulsePhase?: number;
  baseLayer?: BaseLayer;
}): Layer[] {
  const theme = THEMES[baseLayer];
  const previewData = preview ? [preview] : [];
  const previewPieces = preview
    ? densifyGeodesicPieces(preview.source, preview.target, zoom, undefined, viewport).map(
        (piece) => piece.map((point): [number, number] => [point.lng, point.lat]),
      )
    : [];
  const layers: Layer[] = [
    new PathLayer<[number, number][]>({
      id: "range-preview-casing",
      data: previewPieces,
      getPath: (d) => d,
      getColor: theme.lineCasing,
      getWidth: CASED_LINE_WIDTH,
      widthUnits: "pixels",
      widthMinPixels: CASED_LINE_WIDTH,
      jointRounded: true,
      capRounded: true,
      pickable: false,
    }),
    new PathLayer<[number, number][]>({
      id: "range-preview-line",
      data: previewPieces,
      getPath: (d) => d,
      getColor: theme.line,
      getWidth: LINE_WIDTH,
      widthUnits: "pixels",
      widthMinPixels: LINE_WIDTH,
      jointRounded: true,
      capRounded: true,
      pickable: false,
    }),
    new TextLayer<RangePreview>({
      id: "range-preview-label",
      data: previewData,
      getPosition: (d) => [d.target.lng, d.target.lat],
      getText: (d) => d.label,
      getSize: 12,
      getColor: theme.label,
      getTextAnchor: "middle",
      getAlignmentBaseline: "top",
      getPixelOffset: [0, 24],
      ...createLabelStyle(theme),
      pickable: false,
    }),
  ];

  // The pulse says the tap will close the ring rather than place another point,
  // which is the only difference between the two and is otherwise invisible.
  if (closingVertex) {
    layers.push(
      new ScatterplotLayer<PathVertex>({
        id: "range-closing-pulse",
        data: [closingVertex],
        getPosition: (d) => [d.position.lng, d.position.lat],
        getRadius: (d) =>
          (d.anchored ? ANCHORED_VERTEX_RADIUS : FREE_VERTEX_RADIUS) * (1 + pulsePhase * 0.32),
        radiusUnits: "pixels",
        filled: true,
        getFillColor: (d) => pathVertexFillColor(d, baseLayer, true),
        stroked: true,
        getLineColor: (d) => rangeVertexRingColor(d, baseLayer),
        lineWidthUnits: "pixels",
        getLineWidth: (d) => (d.anchored ? 2 : 1),
        opacity: 0.65 + pulsePhase * 0.35,
        pickable: false,
        updateTriggers: { getRadius: pulsePhase },
      }),
    );
  }

  return layers;
}

export function composePathLayers(
  baseLayers: readonly Layer[],
  interactionLayers: readonly Layer[],
): Layer[] {
  const vertexLayerIndex = baseLayers.findIndex((layer) => layer.id === PATH_VERTEX_LAYER_ID);
  if (vertexLayerIndex === -1) return [...baseLayers, ...interactionLayers];

  const segmentLabelLayerIndex = baseLayers.findIndex(
    (layer) => layer.id === PATH_SEGMENT_LABEL_LAYER_ID,
  );
  const interactionLayerIndex =
    segmentLabelLayerIndex === -1
      ? vertexLayerIndex
      : Math.min(segmentLabelLayerIndex, vertexLayerIndex);
  const labelLayers = interactionLayers.filter((layer) => layer instanceof TextLayer);
  const layersBelowLabels = interactionLayers.filter((layer) => !(layer instanceof TextLayer));

  return [
    ...baseLayers.slice(0, interactionLayerIndex),
    ...layersBelowLabels,
    ...baseLayers.slice(interactionLayerIndex),
    ...labelLayers,
  ];
}

export function createPathLayers({
  data,
  baseLayer = "satellite",
  verticesPickable = false,
  metersPerPx = null,
  zoom,
  viewport,
  projector = null,
  onPathClick,
  editablePathId = null,
  selectedId = null,
}: {
  data: PathLayerData | null;
  baseLayer?: BaseLayer;
  verticesPickable?: boolean;
  metersPerPx?: number | null;
  zoom?: number;
  viewport?: GeodesicViewport;
  projector?: PathProjector | null;
  onPathClick?: (pathId: string) => boolean;
  editablePathId?: string | null;
  selectedId?: string | null;
}) {
  const isEditable = (pathId: string) => pathId === editablePathId || pathId === data?.drawingId;
  const theme = THEMES[baseLayer];
  // A circle is its outline, not the points behind it, so once it is placed the
  // handles and the radius line come off and it looks the same locally as it
  // will once its entity arrives.
  const drawnPaths = data && {
    ...data,
    paths: data.paths.filter(
      (path) => path.drawsAsPath !== false || isEditable(path.id) || path.totals.length > 0,
    ),
  };
  const prepared = preparePathLayerData(drawnPaths ?? null, metersPerPx, projector, zoom, viewport);
  const { lineSegments, segmentLabels, fills, totals, suppressedVertexKeys } = prepared;
  const pathsById = new Map(data?.paths.map((path) => [path.id, path]));
  const vertices = prepared.vertices.filter((vertex) => {
    const path = pathsById.get(vertex.pathId);
    return path?.verticesWhenLocked === true || isEditable(vertex.pathId);
  });
  const endpointTicks = vertices.flatMap((vertex): RangeEndpointTick[] => {
    const path = pathsById.get(vertex.pathId);
    const segment = path?.segments[0];
    if (path?.kind !== "range" || isEditable(vertex.pathId) || vertex.anchored || !segment)
      return [];
    // Compass bearings run clockwise from north; IconLayer angles run counter-clockwise from right.
    const lineAngleDegrees = 90 - segment.bearingDegrees;
    return [
      {
        ...vertex,
        angleDegrees: lineAngleDegrees + 90,
      },
    ];
  });
  const endpointTickKeys = new Set(
    endpointTicks.map((vertex) => `${vertex.pathId}:${vertex.sourceIndex}`),
  );
  const dotVertices = vertices.filter(
    (vertex) => !endpointTickKeys.has(`${vertex.pathId}:${vertex.sourceIndex}`),
  );
  const unresolvedLockedVertices = vertices.filter(
    (vertex) =>
      vertex.anchored &&
      vertex.unresolved &&
      !isEditable(vertex.pathId) &&
      !suppressedVertexKeys.has(`${vertex.pathId}:${vertex.sourceIndex}`),
  );
  const labelStyle = createLabelStyle(theme);

  const pickPathId = (pathId: string | undefined): boolean => {
    if (!pathId || !onPathClick) return false;
    return onPathClick(pathId);
  };
  const pickPath = (
    info: PickingInfo<PathSegment | PathSegmentLabel | PreparedPathTotal>,
  ): boolean => pickPathId(info.object?.pathId);

  const totalLayer = new TextLayer<PreparedPathTotal>({
    id: PATH_TOTAL_LABEL_LAYER_ID,
    data: totals,
    getPosition: (d) => [d.total.position.lng, d.total.position.lat],
    getText: (d) => d.total.label,
    getSize: TOTAL_LABEL_FONT_SIZE,
    getColor: theme.label,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    getPixelOffset: (d) => d.pixelOffset,
    ...labelStyle,
    pickable: onPathClick !== undefined,
    onClick: pickPath,
  });

  const fillLayer = new GeoJsonLayer<{ id: string }>({
    id: PATH_FILL_LAYER_ID,
    data: fills.map(
      (fill): Feature<Polygon, { id: string }> => ({
        type: "Feature",
        properties: { id: fill.pathId },
        geometry: {
          type: "Polygon",
          coordinates: [fill.ring.map((position) => [position.lng, position.lat])],
        },
      }),
    ),
    stroked: false,
    filled: true,
    getFillColor: theme.fill,
    pickable: onPathClick !== undefined,
    onClick: (info) => pickPathId(info.object?.properties.id),
  });

  const lineCasingLayer = new PathLayer<PathLineSegment>({
    id: PATH_LINE_CASING_LAYER_ID,
    data: lineSegments,
    getPath: (d) => d.path.map((point): [number, number] => [point.lng, point.lat]),
    getColor: theme.lineCasing,
    getWidth: (d) => (d.pathId === selectedId ? SELECTED_CASED_LINE_WIDTH : CASED_LINE_WIDTH),
    widthUnits: "pixels",
    widthMinPixels: CASED_LINE_WIDTH,
    jointRounded: true,
    capRounded: true,
    extensions: [dashExtension],
    // @ts-expect-error getDashArray is provided by PathStyleExtension
    getDashArray: (d: PathSegment) => (d.unresolved ? UNRESOLVED_CASING_DASH : SOLID),
    dashJustified: true,
    // the casing is the wider line, so it takes the picks
    pickable: onPathClick !== undefined,
    onClick: pickPath,
  });

  const lineLayer = new PathLayer<PathLineSegment>({
    id: "range-lines",
    data: lineSegments,
    getPath: (d) => d.path.map((point): [number, number] => [point.lng, point.lat]),
    getColor: (d) => (d.unresolved ? theme.lineUnresolved : theme.line),
    getWidth: (d) => (d.pathId === selectedId ? SELECTED_LINE_WIDTH : LINE_WIDTH),
    widthUnits: "pixels",
    widthMinPixels: LINE_WIDTH,
    jointRounded: true,
    capRounded: true,
    extensions: [dashExtension],
    // @ts-expect-error getDashArray is provided by PathStyleExtension
    getDashArray: (d: PathSegment) => (d.unresolved ? UNRESOLVED_DASH : SOLID),
    dashJustified: true,
    pickable: false,
  });

  const segmentLabelLayer = new TextLayer<PathSegmentLabel>({
    id: PATH_SEGMENT_LABEL_LAYER_ID,
    data: segmentLabels,
    getPosition: (d) => [d.position.lng, d.position.lat],
    getText: (d) => d.label,
    getSize: SEGMENT_LABEL_FONT_SIZE,
    getColor: (d) => (d.unresolved ? theme.labelUnresolved : theme.label),
    getAngle: (d) => d.angleDegrees,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    ...labelStyle,
    pickable: onPathClick !== undefined,
    onClick: pickPath,
  });

  const unresolvedVertexCasingLayer = new ScatterplotLayer<PathVertex>({
    id: "range-unresolved-vertex-casing",
    data: unresolvedLockedVertices,
    getPosition: (d) => [d.position.lng, d.position.lat],
    getRadius: ANCHORED_VERTEX_RADIUS,
    radiusUnits: "pixels",
    filled: false,
    stroked: true,
    getLineColor: theme.lineCasing,
    lineWidthUnits: "pixels",
    getLineWidth: ANCHORED_VERTEX_RING_WIDTH * 2,
    extensions: [dashExtension],
    // @ts-expect-error getDashArray is provided by PathStyleExtension
    getDashArray: UNRESOLVED_VERTEX_CASING_DASH,
    pickable: false,
  });

  const vertexLayer = new ScatterplotLayer<PathVertex>({
    id: PATH_VERTEX_LAYER_ID,
    data: dotVertices,
    getPosition: (d) => [d.position.lng, d.position.lat],
    getRadius: (d) =>
      suppressedVertexKeys.has(`${d.pathId}:${d.sourceIndex}`)
        ? 0
        : d.anchored
          ? ANCHORED_VERTEX_RADIUS
          : FREE_VERTEX_RADIUS,
    radiusUnits: "pixels",
    filled: true,
    getFillColor: (d) => pathVertexFillColor(d, baseLayer, isEditable(d.pathId)),
    stroked: true,
    getLineColor: (d) => rangeVertexRingColor(d, baseLayer, isEditable(d.pathId)),
    lineWidthUnits: "pixels",
    getLineWidth: (d) =>
      suppressedVertexKeys.has(`${d.pathId}:${d.sourceIndex}`)
        ? 0
        : d.anchored
          ? ANCHORED_VERTEX_RING_WIDTH
          : 1,
    extensions: [dashExtension],
    // @ts-expect-error getDashArray is provided by PathStyleExtension
    getDashArray: (d: PathVertex) =>
      d.anchored && d.unresolved && !isEditable(d.pathId) ? UNRESOLVED_VERTEX_DASH : SOLID,
    pickable: verticesPickable,
  });

  const endpointTickCasingLayer = new IconLayer<RangeEndpointTick>({
    id: "range-endpoint-tick-casing",
    data: endpointTicks,
    getPosition: (d) => [d.position.lng, d.position.lat],
    getIcon: (d) =>
      d.pathId === selectedId
        ? SELECTED_RANGE_ENDPOINT_TICK_CASING_ICON
        : RANGE_ENDPOINT_TICK_CASING_ICON,
    getSize: RANGE_ENDPOINT_TICK_CASING_ICON_SIZE,
    sizeUnits: "pixels",
    sizeBasis: "width",
    getAngle: (d) => d.angleDegrees,
    getColor: theme.lineCasing,
    pickable: false,
  });

  const endpointTickLayer = new IconLayer<RangeEndpointTick>({
    id: "range-endpoint-ticks",
    data: endpointTicks,
    getPosition: (d) => [d.position.lng, d.position.lat],
    getIcon: (d) =>
      d.pathId === selectedId ? SELECTED_RANGE_ENDPOINT_TICK_ICON : RANGE_ENDPOINT_TICK_ICON,
    getSize: RANGE_ENDPOINT_TICK_SIZE,
    sizeUnits: "pixels",
    sizeBasis: "width",
    getAngle: (d) => d.angleDegrees,
    getColor: (d) => pathVertexFillColor(d, baseLayer, false),
    pickable: false,
  });

  return [
    fillLayer,
    lineCasingLayer,
    lineLayer,
    segmentLabelLayer,
    unresolvedVertexCasingLayer,
    endpointTickCasingLayer,
    endpointTickLayer,
    vertexLayer,
    totalLayer,
  ];
}
