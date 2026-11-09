import type { PickingInfo } from "@deck.gl/core";
import type { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { Geodesic } from "geographiclib-geodesic";
import type { Feature, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import {
  CASED_LINE_WIDTH,
  createPathLayers,
  createRangeInteractionLayers,
  LINE_WIDTH,
  PATH_VERTEX_LAYER_ID,
  rangeVertexRingColor,
  SELECTED_CASED_LINE_WIDTH,
  SELECTED_LINE_WIDTH,
} from "./path-layer";
import {
  ANCHORED_VERTEX_RADIUS,
  downgradeHiddenPathAnchors,
  findDrawnPathVertex,
  isPathLegible,
  LABEL_BACKGROUND_PADDING,
  labelAngle,
  type PathLayerData,
  type PathLineSegment,
  type PathSegment,
  type PathVertex,
  preparePathLayerData,
  TOTAL_LABEL_FONT_SIZE,
} from "./path-logic";

const ORIGIN = { lat: 0, lng: 0 };
const TARGET = { lat: 0, lng: 1 };

function vertex(sourceIndex: number, overrides: Partial<PathVertex> = {}): PathVertex {
  return {
    pathId: "path-1",
    position: ORIGIN,
    sourceIndex,
    anchored: false,
    unresolved: false,
    ...overrides,
  };
}

function segment(
  sourceIndex: number,
  groundDistanceM: number,
  overrides: Partial<PathSegment> = {},
): PathSegment {
  return {
    pathId: "path-1",
    source: ORIGIN,
    target: TARGET,
    sourceIndex,
    sourceAnchored: false,
    targetAnchored: false,
    groundDistanceM,
    position: { lat: 0, lng: 0.5 },
    label: `segment-${sourceIndex}`,
    bearingDegrees: 90,
    unresolved: false,
    ...overrides,
  };
}

function pathData(vertices: PathVertex[], segments: PathSegment[]): PathLayerData {
  return {
    paths: [
      {
        id: "path-1",
        kind: "range",
        vertices,
        segments,
        totals: [],
        closed: false,
        verticesWhenLocked: true,
      },
    ],
    drawingId: "path-1",
  };
}

describe("range vertex tap hit testing", () => {
  const projector = {
    project: ([lng, lat]: [number, number]) => ({ x: lng, y: lat }),
  };

  function tapData(): PathLayerData {
    return {
      paths: [
        {
          id: "pinned",
          kind: "range",
          vertices: [
            vertex(0, {
              pathId: "pinned",
              position: { lat: 10, lng: 10 },
              anchored: true,
            }),
          ],
          segments: [],
          totals: [],
          closed: false,
          verticesWhenLocked: true,
        },
        {
          id: "drawing",
          kind: "range",
          vertices: [
            vertex(0, {
              pathId: "drawing",
              position: { lat: 30, lng: 30 },
              anchored: true,
            }),
          ],
          segments: [],
          totals: [],
          closed: false,
          verticesWhenLocked: true,
        },
      ],
      drawingId: "drawing",
    };
  }

  it("lets a tap on a pinned range and bearing place a drawing point", () => {
    const data = tapData();

    expect(findDrawnPathVertex(data, projector, { x: 10, y: 10 }, data.drawingId)).toBeUndefined();
  });

  it("keeps a tap on the drawing range and bearing's own vertex inert", () => {
    const data = tapData();

    expect(findDrawnPathVertex(data, projector, { x: 30, y: 30 }, data.drawingId)?.pathId).toBe(
      "drawing",
    );
  });
});

describe("range marker suppression", () => {
  const metersPerPx = 10;

  it("keeps a free marker however short its segment is", () => {
    const result = preparePathLayerData(
      pathData([vertex(7), vertex(8)], [segment(7, 1 * metersPerPx)]),
      metersPerPx,
    );

    expect(result.suppressedVertexKeys).toEqual(new Set());
  });

  it("hides an anchored marker at the combined line clearance", () => {
    const result = preparePathLayerData(
      pathData([vertex(7, { anchored: true })], [segment(7, 60 * metersPerPx)]),
      metersPerPx,
    );

    // 600 m / 10 m/px = 60 px, equal to 2 × (22 px ring radius + 8 px clearance) = 60 px.
    expect(result.suppressedVertexKeys).toEqual(new Set(["path-1:7"]));
  });

  it("keeps an anchored marker above the combined line clearance", () => {
    const result = preparePathLayerData(
      pathData([vertex(7, { anchored: true })], [segment(7, 61 * metersPerPx)]),
      metersPerPx,
    );

    // 610 m / 10 m/px = 61 px, above 2 × (22 px ring radius + 8 px clearance) = 60 px.
    expect(result.suppressedVertexKeys).toEqual(new Set());
  });

  it("hides only the anchored end of a mixed pair", () => {
    const result = preparePathLayerData(
      pathData([vertex(7), vertex(8, { anchored: true })], [segment(7, 40 * metersPerPx)]),
      metersPerPx,
    );

    // 400 m / 10 m/px = 40 px, below the anchored 60 px clearance.
    expect(result.suppressedVertexKeys).toEqual(new Set(["path-1:8"]));
  });

  it("matches markers by source index rather than array position", () => {
    const result = preparePathLayerData(
      pathData(
        [vertex(99, { anchored: true }), vertex(7, { anchored: true })],
        [segment(7, 9 * metersPerPx)],
      ),
      metersPerPx,
    );

    // 90 m / 10 m/px = 9 px, so source index 7 is hidden even though it is array position 1.
    expect(result.suppressedVertexKeys).toEqual(new Set(["path-1:7"]));
  });
});

describe("range segment label visibility", () => {
  const metersPerPx = 10;
  const longSegment = segment(1, 200 * metersPerPx);

  it("hides a multi-segment label below the length limit", () => {
    const result = preparePathLayerData(
      pathData([], [segment(0, 139 * metersPerPx), longSegment]),
      metersPerPx,
    );

    // 1,390 m / 10 m/px = 139 px, below the 140 px label limit.
    expect(result.segmentLabels.map((item) => item.sourceIndex)).toEqual([1]);
  });

  it("keeps a multi-segment label at the length limit", () => {
    const result = preparePathLayerData(
      pathData([], [segment(0, 140 * metersPerPx), longSegment]),
      metersPerPx,
    );

    // 1,400 m / 10 m/px = 140 px, exactly the 140 px label limit.
    expect(result.segmentLabels.map((item) => item.sourceIndex)).toEqual([0, 1]);
  });

  it("keeps segment labels when ground scale is unavailable", () => {
    const result = preparePathLayerData(pathData([], [segment(0, 10), segment(1, 20)]), null);

    expect(result.segmentLabels.map((item) => item.sourceIndex)).toEqual([0, 1]);
  });
});

describe("range line trimming", () => {
  const metersPerPx = 10;

  it("trims a drawn anchored source marker", () => {
    const result = preparePathLayerData(
      pathData(
        [vertex(0, { anchored: true }), vertex(1)],
        [segment(0, 1000, { sourceAnchored: true })],
      ),
      metersPerPx,
    );

    // The line clearance is 22 px + 8 px = 30 px, so 30 px × 10 m/px trims 300 m.
    const moved = Geodesic.WGS84.Inverse(
      ORIGIN.lat,
      ORIGIN.lng,
      result.lineSegments[0]!.source.lat,
      result.lineSegments[0]!.source.lng,
    ).s12;
    expect(moved).toBeCloseTo(300, 6);
  });

  it("trims a drawn anchored target marker", () => {
    const result = preparePathLayerData(
      pathData(
        [vertex(0), vertex(1, { anchored: true })],
        [segment(0, 1000, { targetAnchored: true })],
      ),
      metersPerPx,
    );

    // The line clearance is 22 px + 8 px = 30 px, so the target lands 1,000 m - 300 m = 700 m.
    const moved = Geodesic.WGS84.Inverse(
      ORIGIN.lat,
      ORIGIN.lng,
      result.lineSegments[0]!.target.lat,
      result.lineSegments[0]!.target.lng,
    ).s12;
    expect(moved).toBeCloseTo(700, 6);
  });

  it("does not trim free endpoints", () => {
    const result = preparePathLayerData(
      pathData([vertex(0), vertex(1)], [segment(0, 1000)]),
      metersPerPx,
    );

    expect(result.lineSegments[0]).toMatchObject({ source: ORIGIN, target: TARGET });
  });

  it("does not trim an anchored endpoint whose marker is hidden", () => {
    const result = preparePathLayerData(
      pathData(
        [vertex(0, { anchored: true }), vertex(1, { anchored: true })],
        [segment(0, 60 * metersPerPx, { sourceAnchored: true, targetAnchored: true })],
      ),
      metersPerPx,
    );

    // 600 m / 10 m/px = 60 px, equal to 2 × 30 px, so both hidden markers leave the line untrimmed.
    expect(result.lineSegments[0]).toMatchObject({ source: ORIGIN, target: TARGET });
  });

  it("drops a line at its combined endpoint trim", () => {
    const result = preparePathLayerData(
      pathData([], [segment(0, 60 * metersPerPx, { sourceAnchored: true, targetAnchored: true })]),
      metersPerPx,
    );

    // 600 m equals 2 × (22 px + 8 px) × 10 m/px = 600 m of combined trim.
    expect(result.lineSegments).toEqual([]);
  });

  it("keeps a line longer than its combined endpoint trim", () => {
    const result = preparePathLayerData(
      pathData(
        [vertex(0, { anchored: true }), vertex(1, { anchored: true })],
        [segment(0, 61 * metersPerPx, { sourceAnchored: true, targetAnchored: true })],
      ),
      metersPerPx,
    );

    // 610 m is above 2 × (22 px + 8 px) × 10 m/px = 600 m of combined trim.
    expect(result.lineSegments).toHaveLength(1);
  });

  it("never draws both anchored markers without their connecting line", () => {
    for (let segmentLengthPx = 44; segmentLengthPx <= 60; segmentLengthPx += 1) {
      const result = preparePathLayerData(
        pathData(
          [vertex(0, { anchored: true }), vertex(1, { anchored: true })],
          [
            segment(0, segmentLengthPx * metersPerPx, {
              sourceAnchored: true,
              targetAnchored: true,
            }),
          ],
        ),
        metersPerPx,
      );
      const bothMarkersDraw =
        !result.suppressedVertexKeys.has("path-1:0") &&
        !result.suppressedVertexKeys.has("path-1:1");

      // 44–60 px brackets the 2 × (22 px + 8 px) = 60 px limit from both sides.
      expect(bothMarkersDraw && result.lineSegments.length === 0, `${segmentLengthPx} px`).toBe(
        false,
      );
    }
  });
});

describe("completed path fills", () => {
  it("routes fill clicks through the path click handler", () => {
    const data = pathData(
      [
        vertex(0, { position: { lat: 51.2, lng: -2.4 } }),
        vertex(1, { position: { lat: 52.1, lng: 0.7 } }),
        vertex(2, { position: { lat: 49.6, lng: 1.3 } }),
      ],
      [],
    );
    data.paths[0]!.closed = true;
    data.drawingId = null;
    let clickedPathId: string | null = null;
    const fillLayer = createPathLayers({
      data,
      onPathClick: (pathId) => {
        clickedPathId = pathId;
        return true;
      },
    }).find((layer) => layer.id === "range-fills") as GeoJsonLayer<{ id: string }>;
    const fillData = fillLayer.props.data;
    const onClick = fillLayer.props.onClick;

    expect(fillLayer.props.pickable).toBe(true);
    expect(Array.isArray(fillData)).toBe(true);
    expect(onClick).toBeTypeOf("function");
    if (Array.isArray(fillData) && onClick) {
      const feature = fillData[0] as Feature<Polygon, { id: string }>;
      expect(feature.properties.id).toBe("path-1");
      expect(onClick({ object: feature } as PickingInfo<typeof feature>, undefined as never)).toBe(
        true,
      );
    }
    expect(clickedPathId).toBe("path-1");
  });
});

describe("path strokes", () => {
  it("keeps widths aligned and resolved colors opaque without flattening unresolved strokes", () => {
    expect(LINE_WIDTH).toBe(1.5);
    expect(SELECTED_LINE_WIDTH).toBe(3);
    expect((CASED_LINE_WIDTH - LINE_WIDTH) / 2).toBe(1.25);
    expect((SELECTED_CASED_LINE_WIDTH - SELECTED_LINE_WIDTH) / 2).toBe(1.25);

    const farTarget = { lat: 1, lng: 2 };
    const data = pathData(
      [vertex(0), vertex(1, { position: TARGET }), vertex(2, { position: farTarget })],
      [
        segment(0, 2_000),
        segment(1, 3_000, {
          source: TARGET,
          target: farTarget,
          unresolved: true,
        }),
      ],
    );
    const lineLayer = createPathLayers({ data, baseLayer: "dark" }).find(
      (layer) => layer.id === "range-lines",
    ) as PathLayer<PathLineSegment>;
    const segments = lineLayer.props.data as readonly PathLineSegment[];
    const getColor = lineLayer.props.getColor;

    expect(getColor).toBeTypeOf("function");
    if (typeof getColor === "function") {
      const context = { index: 0, data: segments, target: [] };
      const resolved = segments.find((candidate) => !candidate.unresolved);
      const unresolved = segments.find((candidate) => candidate.unresolved);
      expect(resolved).toBeDefined();
      expect(unresolved).toBeDefined();
      expect(getColor(resolved!, context)).toEqual([80, 140, 255, 255]);
      expect(getColor(unresolved!, context)).toEqual([80, 140, 255, 80]);
    }
  });
});

describe("range interaction layers", () => {
  const preview = { source: ORIGIN, target: TARGET, label: "111 km" };

  it("draws the preview line and distance label", () => {
    const layers = createRangeInteractionLayers({ preview });

    expect(layers.map((layer) => layer.id)).toEqual([
      "range-preview-casing",
      "range-preview-line",
      "range-preview-label",
    ]);
    const casingLayer = layers[0] as PathLayer<[number, number][]>;
    const lineLayer = layers[1] as PathLayer<[number, number][]>;
    expect(casingLayer.props.getWidth).toBe(CASED_LINE_WIDTH);
    expect(casingLayer.props.widthMinPixels).toBe(CASED_LINE_WIDTH);
    expect(casingLayer.props.jointRounded).toBe(true);
    expect(casingLayer.props.capRounded).toBe(true);
    expect(lineLayer.props.getWidth).toBe(LINE_WIDTH);
    expect(lineLayer.props.widthMinPixels).toBe(LINE_WIDTH);
    expect(lineLayer.props.jointRounded).toBe(true);
    expect(lineLayer.props.capRounded).toBe(true);
    expect(lineLayer.props.getColor).toEqual([255, 255, 255, 255]);
  });
});

describe("range vertex layers", () => {
  type EndpointTick = PathVertex & { angleDegrees: number };

  function renderedVertices(data: PathLayerData, editablePathId: string | null = null) {
    const layer = createPathLayers({ data, editablePathId }).find(
      (candidate) => candidate.id === PATH_VERTEX_LAYER_ID,
    );
    return layer?.props.data as readonly PathVertex[];
  }

  function renderedEndpointTicks(data: PathLayerData, editablePathId: string | null = null) {
    const layer = createPathLayers({ data, editablePathId }).find(
      (candidate) => candidate.id === "range-endpoint-ticks",
    );
    return layer?.props.data as readonly EndpointTick[];
  }

  function offAxisRangeData(bearingDegrees = 145): PathLayerData {
    const source = { lat: 34.2, lng: -117.5 };
    const target = { lat: 36.7, lng: -115.1 };
    const data = pathData(
      [vertex(0, { position: source }), vertex(1, { position: target })],
      [
        segment(0, 360_000, {
          source,
          target,
          bearingDegrees,
          labelBearingDegrees: 215,
        }),
      ],
    );
    data.drawingId = null;
    return data;
  }

  it("keeps endpoint ticks below vertices and out of picking", () => {
    const layers = createPathLayers({ data: null, verticesPickable: true });
    const vertexLayerIndex = layers.findIndex((layer) => layer.id === PATH_VERTEX_LAYER_ID);

    for (const id of ["range-endpoint-tick-casing", "range-endpoint-ticks"]) {
      const tickLayerIndex = layers.findIndex((layer) => layer.id === id);

      expect
        .soft(tickLayerIndex, `${id} renders before ${PATH_VERTEX_LAYER_ID}`)
        .toBeLessThan(vertexLayerIndex);
      expect
        .soft(layers[tickLayerIndex]?.props.pickable, `${id} does not intercept picks`)
        .toBe(false);
    }
  });

  it("draws finished range endpoints perpendicular to an off-axis 145° bearing", () => {
    const bearingDegrees = 145;
    const data = offAxisRangeData(bearingDegrees);
    const layers = createPathLayers({ data, baseLayer: "dark", selectedId: "path-1" });

    const casingLayer = layers.find(
      (candidate) => candidate.id === "range-endpoint-tick-casing",
    ) as IconLayer<EndpointTick>;

    const tickLayer = layers.find(
      (candidate) => candidate.id === "range-endpoint-ticks",
    ) as IconLayer<EndpointTick>;

    const ticks = tickLayer.props.data as readonly EndpointTick[];

    expect(ticks.map((tick) => tick.position)).toEqual([
      { lat: 34.2, lng: -117.5 },
      { lat: 36.7, lng: -115.1 },
    ]);
    expect(layers.indexOf(casingLayer)).toBeLessThan(layers.indexOf(tickLayer));
    expect(casingLayer.props.data).toEqual(ticks);
    expect(tickLayer.props.sizeUnits).toBe("pixels");
    expect(tickLayer.props.sizeBasis).toBe("width");
    expect(casingLayer.props.getSize).toBe(18);
    expect(tickLayer.props.getSize).toBe(14);

    const getAngle = tickLayer.props.getAngle;
    expect(getAngle).toBeTypeOf("function");

    if (typeof getAngle === "function") {
      const bearingRadians = (bearingDegrees * Math.PI) / 180;

      const lineScreenAngle =
        (Math.atan2(Math.cos(bearingRadians), Math.sin(bearingRadians)) * 180) / Math.PI;

      for (const [index, tick] of ticks.entries()) {
        const tickAngle = getAngle(tick, { index, data: ticks, target: [] });
        const angleDelta = ((tickAngle - lineScreenAngle + 540) % 360) - 180;
        expect(
          Math.abs(angleDelta),
          `tick at ${bearingDegrees}° is perpendicular to its line`,
        ).toBe(90);
      }
    }

    const getCasingIcon = casingLayer.props.getIcon;
    const getTickIcon = tickLayer.props.getIcon;
    expect(getCasingIcon).toBeTypeOf("function");
    expect(getTickIcon).toBeTypeOf("function");

    if (typeof getCasingIcon === "function" && typeof getTickIcon === "function") {
      const context = { index: 0, data: ticks, target: [] };
      const casingIcon = getCasingIcon(ticks[0]!, context);
      const tickIcon = getTickIcon(ticks[0]!, context);
      expect(casingIcon).not.toBeTypeOf("string");
      expect(tickIcon).not.toBeTypeOf("string");

      if (typeof casingIcon !== "string" && typeof tickIcon !== "string") {
        const casingSvg = decodeURIComponent(casingIcon.url);
        const tickSvg = decodeURIComponent(tickIcon.url);

        const readRectDimension = (svg: string, dimension: "height" | "width" | "x") =>
          Number(svg.match(new RegExp(`<rect[^>]+${dimension}="([^"]+)"`))?.[1]);

        const casingThickness = readRectDimension(casingSvg, "height");
        const tickThickness = readRectDimension(tickSvg, "height");
        expect(casingIcon).toMatchObject({
          width: 18,
          height: 18,
          anchorX: 9,
          anchorY: 9,
          mask: true,
        });
        expect(tickIcon).toMatchObject({
          width: 14,
          height: 14,
          anchorX: 7,
          anchorY: 7,
          mask: true,
        });
        expect(casingThickness).toBe(SELECTED_CASED_LINE_WIDTH);
        expect(tickThickness).toBe(SELECTED_LINE_WIDTH);
        expect(readRectDimension(casingSvg, "x")).toBe(0.75);
        expect(readRectDimension(casingSvg, "width")).toBe(16.5);
        expect(readRectDimension(tickSvg, "x")).toBe(0);
        expect(readRectDimension(tickSvg, "width")).toBe(14);
        expect(casingThickness).toBeGreaterThan(tickThickness);
      }
    }

    const getCasingColor = casingLayer.props.getColor;
    const getTickColor = tickLayer.props.getColor;
    expect(getCasingColor).toEqual([16, 20, 28, 220]);
    expect(getTickColor).toBeTypeOf("function");

    if (typeof getTickColor === "function") {
      expect(getTickColor(ticks[0]!, { index: 0, data: ticks, target: [] })).toEqual([
        80, 140, 255, 255,
      ]);
    }
  });

  it("keeps editable range endpoints as dots", () => {
    const data = offAxisRangeData();
    data.drawingId = "path-1";

    expect(renderedEndpointTicks(data), "editable range endpoints stay dots").toEqual([]);
    expect(renderedVertices(data)).toEqual(data.paths[0]!.vertices);
  });

  it("keeps finished non-range vertices as dots", () => {
    const data = offAxisRangeData();
    data.paths[0]!.kind = "freeform";

    expect(renderedEndpointTicks(data)).toEqual([]);
    expect(renderedVertices(data)).toEqual(data.paths[0]!.vertices);
  });

  it("keeps an unresolved anchored endpoint as its dashed ring", () => {
    const data = offAxisRangeData();
    const anchored = data.paths[0]!.vertices[0]!;
    anchored.anchored = true;
    anchored.unresolved = true;
    data.paths[0]!.segments[0]!.sourceAnchored = true;
    data.paths[0]!.segments[0]!.unresolved = true;
    const layers = createPathLayers({ data });
    const vertexLayer = layers.find(
      (candidate) => candidate.id === PATH_VERTEX_LAYER_ID,
    ) as ScatterplotLayer<PathVertex>;
    const ticks = renderedEndpointTicks(data);

    expect(ticks).toEqual([expect.objectContaining({ sourceIndex: 1, anchored: false })]);
    expect(vertexLayer?.props.data).toEqual([anchored]);

    const getRadius = vertexLayer.props.getRadius;
    const getFillColor = vertexLayer.props.getFillColor;
    const { getDashArray } = vertexLayer.props as typeof vertexLayer.props & {
      getDashArray: (
        vertex: PathVertex,
        context: { index: number; data: PathVertex[]; target: unknown[] },
      ) => [number, number];
    };
    expect(getRadius).toBeTypeOf("function");
    expect(getFillColor).toBeTypeOf("function");
    expect(getDashArray).toBeTypeOf("function");
    if (
      typeof getRadius === "function" &&
      typeof getFillColor === "function" &&
      typeof getDashArray === "function"
    ) {
      const context = { index: 0, data: [anchored], target: [] };
      expect(getRadius(anchored, context)).toBe(ANCHORED_VERTEX_RADIUS);
      expect(getFillColor(anchored, context)).toEqual([0, 0, 0, 0]);
      expect(getDashArray(anchored, context)).toEqual([6, 3]);
    }
  });

  it("hides finished freeform vertices and emphasizes its selected line", () => {
    const data = pathData(
      [vertex(0), vertex(1, { position: TARGET })],
      [segment(0, 2_000, { position: ORIGIN })],
    );
    data.paths[0]!.kind = "freeform";
    data.paths[0]!.verticesWhenLocked = false;
    data.drawingId = null;

    expect(renderedVertices(data)).toEqual([]);

    const layers = createPathLayers({ data, selectedId: "path-1" });
    const casingLayer = layers.find(
      (layer) => layer.id === "range-line-casing",
    ) as PathLayer<PathLineSegment>;
    const lineLayer = layers.find(
      (layer) => layer.id === "range-lines",
    ) as PathLayer<PathLineSegment>;
    const segments = lineLayer.props.data as readonly PathLineSegment[];
    const context = { index: 0, data: segments, target: [] };
    const getCasingWidth = casingLayer.props.getWidth;
    const getLineWidth = lineLayer.props.getWidth;

    expect(casingLayer.props.jointRounded).toBe(true);
    expect(casingLayer.props.capRounded).toBe(true);
    expect(lineLayer.props.jointRounded).toBe(true);
    expect(lineLayer.props.capRounded).toBe(true);
    expect(getCasingWidth).toBeTypeOf("function");
    expect(getLineWidth).toBeTypeOf("function");
    if (typeof getCasingWidth === "function" && typeof getLineWidth === "function") {
      expect(getCasingWidth(segments[0]!, context)).toBe(SELECTED_CASED_LINE_WIDTH);
      expect(getLineWidth(segments[0]!, context)).toBe(SELECTED_LINE_WIDTH);
    }
  });

  it.each([
    ["placing", "path-1", null],
    ["editing", null, "path-1"],
  ])("shows freeform vertices while %s", (_mode, drawingId, editablePathId) => {
    const data = pathData([vertex(0)], []);
    data.paths[0]!.kind = "freeform";
    data.paths[0]!.verticesWhenLocked = false;
    data.drawingId = drawingId;

    expect(renderedVertices(data, editablePathId)).toEqual([vertex(0)]);
  });
});

describe("range and bearing legibility", () => {
  const data = pathData(
    [vertex(0), vertex(1, { position: TARGET })],
    [segment(0, 2000, { position: ORIGIN })],
  );
  const path = data.paths[0]!;

  it("calls a range and bearing shorter than two markers illegible", () => {
    // 2,000 m / 100 m per px = 20 px across, under the 60 px of two anchored markers.
    expect(isPathLegible(path, 100)).toBe(false);
  });

  it("calls it legible once it clears them", () => {
    // 2,000 m / 20 m per px = 100 px across.
    expect(isPathLegible(path, 20)).toBe(true);
  });

  it("still draws the line when it is illegible, so nothing vanishes", () => {
    const result = preparePathLayerData(data, 100);

    expect(result.lineSegments).toHaveLength(1);
  });

  it("assumes legible without a ground scale", () => {
    expect(isPathLegible(path, null)).toBe(true);
  });
});

describe("range total placement", () => {
  const totalLabelHalfHeight = TOTAL_LABEL_FONT_SIZE / 2 + LABEL_BACKGROUND_PADDING[1];

  it("places a ring total on its stroke", () => {
    const data = pathData([vertex(0)], []);
    data.paths[0]!.rings = 3;
    data.paths[0]!.totals = [{ position: TARGET, label: "100 m" }];

    const { pixelOffset } = preparePathLayerData(data, 10).totals[0]!;

    expect(pixelOffset).toEqual([0, 0]);
  });

  it("places the total above an anchored last vertex", () => {
    const data = pathData(
      [vertex(0), vertex(1, { position: TARGET }), vertex(2, { anchored: true })],
      [segment(0, 100), segment(1, 100)],
    );
    data.paths[0]!.totals = [{ position: ORIGIN, label: "Σ 200 m" }];

    const [, yOffset] = preparePathLayerData(data, 10).totals[0]!.pixelOffset;

    expect(yOffset).toBeLessThan(0);
    expect(Math.abs(yOffset)).toBeGreaterThan(ANCHORED_VERTEX_RADIUS + totalLabelHalfHeight);
  });
});

describe("range label rotation", () => {
  it.each([
    {
      name: "the full compass in quarter-degree steps",
      bearings: Array.from({ length: 1440 }, (_, index) => (index + 1) / 4),
    },
  ])("aligns upright text with the geodesic tangent at $name", ({ bearings }) => {
    for (const bearing of bearings) {
      const projected = [-10, 10].map((distanceM) => {
        const { lat2, lon2 } = Geodesic.WGS84.Direct(70, 21, bearing, distanceM);
        if (lat2 === undefined || lon2 === undefined) throw new Error("Missing reference point");
        return {
          x: lon2 / 360,
          y: -Math.log(Math.tan(Math.PI / 4 + (lat2 * Math.PI) / 360)) / (2 * Math.PI),
        };
      });
      const [before, after] = projected;
      if (!before || !after) throw new Error("Missing reference tangent");
      const tangentScreenDegrees =
        (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
      const rotation = labelAngle(bearing);
      const orientationErrorDegrees = Math.abs(
        ((((-rotation - tangentScreenDegrees) % 180) + 270) % 180) - 90,
      );
      expect(
        orientationErrorDegrees,
        `${bearing}°: rendered label must align with the geodesic tangent within 0.05 degrees`,
      ).toBeLessThan(0.05);
      // Upright text reads left-to-right; exact vertical text reads bottom-to-top in either direction.
      expect(rotation, `${bearing}°: upright rotation must be greater than -90°`).toBeGreaterThan(
        -90,
      );
      expect(rotation, `${bearing}°: upright rotation must not exceed +90°`).toBeLessThanOrEqual(
        90,
      );
    }
  });
});

describe("hidden range anchors", () => {
  const anchoredVertex = vertex(4, { anchored: true, entityId: "anchor" });
  const anchoredSegment = segment(4, 1000, {
    sourceAnchored: true,
    targetAnchored: true,
  });

  it("shows a hidden resolved anchor as a free vertex", () => {
    const result = downgradeHiddenPathAnchors(
      pathData([anchoredVertex], [anchoredSegment]),
      new Set(),
    );

    expect(result?.paths[0]?.vertices[0]!.anchored).toBe(false);
  });

  it("keeps a visible anchor anchored", () => {
    const result = downgradeHiddenPathAnchors(
      pathData([anchoredVertex], [anchoredSegment]),
      new Set(["anchor"]),
    );

    expect(result?.paths[0]?.vertices[0]!.anchored).toBe(true);
  });

  it("keeps an unresolved anchor anchored", () => {
    const result = downgradeHiddenPathAnchors(
      pathData([{ ...anchoredVertex, unresolved: true }], [anchoredSegment]),
      new Set(),
    );

    expect(result?.paths[0]?.vertices[0]!.anchored).toBe(true);
  });

  it("keeps an anchor without an entity identity anchored", () => {
    const result = downgradeHiddenPathAnchors(
      pathData([vertex(4, { anchored: true })], [anchoredSegment]),
      new Set(),
    );

    expect(result?.paths[0]?.vertices[0]!.anchored).toBe(true);
  });

  it("downgrades segment ends attached to hidden anchors", () => {
    const result = downgradeHiddenPathAnchors(
      pathData(
        [anchoredVertex, vertex(5, { anchored: true, entityId: "visible" })],
        [anchoredSegment],
      ),
      new Set(["visible"]),
    );

    expect(result?.paths[0]?.segments[0]).toMatchObject({
      sourceAnchored: false,
      targetAnchored: true,
    });
  });
});

describe("range label collision", () => {
  const metersPerPx = 10;
  const LONG = 200 * metersPerPx;
  const FAR = { lat: 1, lng: 1 };

  // labels stack on one x, 20 px apart. a horizontal badge is 18 px tall plus 4 px clearance, so
  // two of them collide until they are 26 px apart.
  function stackedProjector(order: { lat: number; lng: number }[]) {
    return {
      project: ([lng, lat]: [number, number]) => {
        const index = order.findIndex((p) => p.lat === lat && p.lng === lng);
        return { x: 100, y: 100 + (index < 0 ? 1000 : index * 20) };
      },
    };
  }

  function twoRbs(secondPosition: { lat: number; lng: number }): PathLayerData {
    return {
      drawingId: null,
      paths: [
        {
          id: "path-1",
          kind: "range",
          vertices: [],
          segments: [segment(0, LONG)],
          totals: [],
          closed: false,
          verticesWhenLocked: true,
        },
        {
          id: "path-2",
          kind: "range",
          vertices: [],
          segments: [segment(0, LONG, { pathId: "path-2", position: secondPosition })],
          totals: [],
          closed: false,
          verticesWhenLocked: true,
        },
      ],
    };
  }

  it("drops the second range and bearing's label when the two collide", () => {
    const data = twoRbs(TARGET);
    const result = preparePathLayerData(
      data,
      metersPerPx,
      stackedProjector([data.paths[0]!.segments[0]!.position, TARGET]),
    );

    expect(result.segmentLabels.map((item) => item.pathId)).toEqual(["path-1"]);
  });

  it("keeps both when they project far apart", () => {
    const data = twoRbs(FAR);
    const result = preparePathLayerData(data, metersPerPx, {
      project: ([lng]: [number, number]) => ({ x: lng === FAR.lng ? 900 : 100, y: 100 }),
    });

    expect(result.segmentLabels).toHaveLength(2);
  });

  it("lets a total outrank a segment label it lands on", () => {
    const data = twoRbs(TARGET);
    data.paths[1]!.totals = [{ position: TARGET, label: "Σ 2 km" }];
    const result = preparePathLayerData(data, metersPerPx, {
      project: () => ({ x: 100, y: 100 }),
    });

    expect(result.totals).toHaveLength(1);
    expect(result.segmentLabels).toEqual([]);
  });

  it("keeps the first of two colliding segment labels and drops the second", () => {
    const data: PathLayerData = {
      drawingId: null,
      paths: [
        {
          id: "path-1",
          kind: "range",
          vertices: [],
          segments: [segment(0, LONG), segment(1, LONG, { position: TARGET })],
          totals: [],
          closed: false,
          verticesWhenLocked: true,
        },
      ],
    };
    const result = preparePathLayerData(
      data,
      metersPerPx,
      stackedProjector([data.paths[0]!.segments[0]!.position, TARGET]),
    );

    expect(result.segmentLabels).toHaveLength(1);
  });
});

describe("free vertex ring", () => {
  it("does not follow the basemap, so it still reads on the pale one", () => {
    const rings = (["satellite", "dark", "street"] as const).map((baseLayer) =>
      rangeVertexRingColor(vertex(0), baseLayer),
    );

    expect(new Set(rings.map((ring) => ring.join(",")))).toHaveLength(1);
    for (const [red, green, blue] of rings) {
      expect(Math.max(red, green, blue)).toBeLessThan(60);
    }
  });
});

describe("unresolved vertex ring", () => {
  it("stays muted on every basemap when locked", () => {
    const alphas = (["satellite", "dark", "street"] as const).map(
      (baseLayer) =>
        rangeVertexRingColor(vertex(0, { anchored: true, unresolved: true }), baseLayer, false)[3],
    );

    expect(alphas).toEqual([80, 80, 80]);
  });
});
