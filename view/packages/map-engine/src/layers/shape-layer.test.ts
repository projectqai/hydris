import { _compareProps } from "@deck.gl/core";
import { describe, expect, it } from "vitest";

import type { RGBA } from "../types";
import { circleToPolygon } from "../utils/geodesic-circle";
import { shapeToFeatures } from "../utils/shape-to-geojson";
import {
  CASED_LINE_WIDTH,
  LINE_WIDTH,
  pathCasingColor,
  SELECTED_CASED_LINE_WIDTH,
  SELECTED_LINE_WIDTH,
} from "./path-layer";
import { createShapeLayer } from "./shape-layer";

describe("saved shape fills", () => {
  it("compares the generated partitions without suppressing edits or deletions", () => {
    const data = [
      ...shapeToFeatures(
        "first",
        circleToPolygon({ lat: 70.3, lng: 19.7 }, 37_000),
        "unclassified",
        true,
      ),
      ...shapeToFeatures("second", circleToPolygon({ lat: 67.1, lng: 23.4 }, 91_000), "red", true),
    ];
    const props = { data, visible: true, selectedId: null, drawnColor: [11, 37, 83, 255] as RGBA };
    const first = createShapeLayer(props);
    const repeated = createShapeLayer(props);
    const edited = createShapeLayer({
      ...props,
      data: [
        ...shapeToFeatures(
          "first",
          circleToPolygon({ lat: 71.2, lng: 18.6 }, 43_000),
          "blue",
          true,
        ),
        data[1]!,
      ],
    });
    const deleted = createShapeLayer({ ...props, data: data.slice(0, 1) });
    const reordered = createShapeLayer({ ...props, data: [...data].reverse() });
    for (const [index, layer] of first.entries()) {
      const next = repeated[index]!;
      expect(next.props.data).not.toBe(layer.props.data);
      expect(next.props.dataComparator?.(next.props.data, layer.props.data)).toBe(true);
      for (const changed of [edited[index]!, deleted[index]!, reordered[index]!]) {
        expect(changed.props.dataComparator?.(changed.props.data, layer.props.data)).toBe(false);
      }
    }
  });

  it("invalidates selected widths and drawn colors independently of shape data", () => {
    const data = shapeToFeatures(
      "outline",
      circleToPolygon({ lat: 71.3, lng: 23.7 }, 83_000),
      "unclassified",
      true,
    );
    const props = { data, visible: true, selectedId: null, drawnColor: [11, 37, 83, 255] as RGBA };
    const initial = createShapeLayer(props);
    const selected = createShapeLayer({ ...props, selectedId: "outline" });
    const recolored = createShapeLayer({ ...props, drawnColor: [149, 71, 29, 255] });
    for (const [index, layer] of initial.entries()) {
      const next = selected[index]!;
      expect(next.props.dataComparator?.(next.props.data, layer.props.data)).toBe(true);
      expect(
        _compareProps({
          newProps: next.props.updateTriggers,
          oldProps: layer.props.updateTriggers,
        }),
      ).toBeTruthy();
      const width = next.props.getLineWidth;
      if (typeof width !== "function") throw new Error("Expected shape width accessor");
      expect(width(data[0]!, { index: 0, data, target: [] })).toBe(
        layer.id === "shapes-casing" ? SELECTED_CASED_LINE_WIDTH : SELECTED_LINE_WIDTH,
      );
    }
    const before = initial.find((layer) => layer.id === "shapes")!;
    const after = recolored.find((layer) => layer.id === "shapes")!;
    expect(
      _compareProps({
        newProps: after.props.updateTriggers,
        oldProps: before.props.updateTriggers,
      }),
    ).toBeTruthy();
    const color = after.props.getLineColor;
    if (typeof color !== "function") throw new Error("Expected shape color accessor");
    expect(color(data[0]!, { index: 0, data, target: [] })).toEqual([149, 71, 29, 255]);
  });

  it("fills drawn polygons without filling other polygons", () => {
    const [drawnPolygon] = shapeToFeatures(
      "drawn",
      {
        type: "polygon",
        outer: [
          { lat: 55.3, lng: -3.8 },
          { lat: 53.9, lng: 0.6 },
          { lat: 50.7, lng: -1.1 },
        ],
      },
      "unclassified",
      true,
    );
    const [otherPolygon] = shapeToFeatures(
      "other",
      {
        type: "polygon",
        outer: [
          { lat: 47.2, lng: -4.6 },
          { lat: 49.8, lng: 1.7 },
          { lat: 45.9, lng: 2.4 },
        ],
      },
      "blue",
    );
    const layers = createShapeLayer({
      data: [drawnPolygon!, otherPolygon!],
      visible: true,
      selectedId: "other",
      drawnColor: [11, 37, 83, 255],
      fillColor: [17, 43, 91, 37],
      baseLayer: "street",
    });
    const fillLayer = layers.find((layer) => layer.id === "shapes-drawn-fill");
    const casingLayer = layers.find((layer) => layer.id === "shapes-casing");
    const outlineLayer = layers.find((layer) => layer.id === "shapes");

    expect(fillLayer?.props.data).toEqual([drawnPolygon]);
    expect(fillLayer?.props.filled).toBe(true);
    expect(layers).toEqual([fillLayer, casingLayer, outlineLayer]);
    expect(outlineLayer?.props.data).toEqual([drawnPolygon, otherPolygon]);
    expect(casingLayer?.props.data).toBe(outlineLayer?.props.data);
    expect(outlineLayer?.props.filled).toBe(false);
    expect(casingLayer?.props.filled).toBe(false);
    expect(casingLayer?.props.pickable).toBe(false);
    expect(outlineLayer?.props.pickable).toBe(true);
    expect(casingLayer?.props.getLineColor).toEqual(pathCasingColor("street"));
    expect(casingLayer?.props.lineWidthMinPixels).toBe(CASED_LINE_WIDTH);
    expect(casingLayer?.props.lineJointRounded).toBe(true);
    expect(casingLayer?.props.lineCapRounded).toBe(true);
    expect(outlineLayer?.props.lineJointRounded).toBe(true);
    expect(outlineLayer?.props.lineCapRounded).toBe(true);

    const getCasingWidth = casingLayer?.props.getLineWidth;
    const getLineWidth = outlineLayer?.props.getLineWidth;
    expect(getCasingWidth).toBeTypeOf("function");
    expect(getLineWidth).toBeTypeOf("function");
    if (typeof getCasingWidth === "function" && typeof getLineWidth === "function") {
      const context = { index: 0, data: [drawnPolygon!, otherPolygon!], target: [] };
      expect(getCasingWidth(drawnPolygon!, context)).toBe(CASED_LINE_WIDTH);
      expect(getCasingWidth(otherPolygon!, context)).toBe(SELECTED_CASED_LINE_WIDTH);
      expect(getLineWidth(drawnPolygon!, context)).toBe(LINE_WIDTH);
      expect(getLineWidth(otherPolygon!, context)).toBe(SELECTED_LINE_WIDTH);
    }
  });

  it("keeps drawn ring sets as unfilled outlines", () => {
    const centre = { lat: 51.7, lng: -1.8 };
    const [drawnCircle] = shapeToFeatures(
      "drawn-circle",
      circleToPolygon(centre, 1_700),
      "unclassified",
      true,
    );
    const ringSet = shapeToFeatures(
      "ring-set",
      {
        type: "collection",
        geometries: [circleToPolygon(centre, 900), circleToPolygon(centre, 1_800)],
      },
      "unclassified",
      true,
    );
    const drawnColor: RGBA = [11, 37, 83, 255];
    const layers = createShapeLayer({
      data: [...ringSet, drawnCircle!],
      visible: true,
      selectedId: null,
      drawnColor,
      fillColor: [17, 43, 91, 37],
    });
    const filledLayer = layers.find((layer) => layer.props.filled);
    const filledData = Array.isArray(filledLayer?.props.data) ? filledLayer.props.data : [];
    const ringOutlineLayer = layers.find((layer) => layer.id === "shapes");
    expect(ringOutlineLayer?.props.data).toEqual([drawnCircle, ...ringSet]);

    expect(ringSet.filter((feature) => filledData.includes(feature))).toHaveLength(0);
    expect(filledData).toContain(drawnCircle);
    expect(ringOutlineLayer?.props.stroked).toBe(true);
    expect(ringOutlineLayer?.props.pickable).toBe(true);
    expect(ringOutlineLayer?.props.lineWidthMinPixels).toBe(LINE_WIDTH);

    const getLineColor = ringOutlineLayer?.props.getLineColor;
    expect(getLineColor).toBeTypeOf("function");
    if (typeof getLineColor === "function") {
      expect(getLineColor(ringSet[0]!, { index: 0, data: ringSet, target: [] })).toEqual(
        drawnColor,
      );
    }

    const getLineWidth = ringOutlineLayer?.props.getLineWidth;
    expect(getLineWidth).toBeTypeOf("function");
    if (typeof getLineWidth === "function") {
      expect(getLineWidth(ringSet[0]!, { index: 0, data: ringSet, target: [] })).toBe(LINE_WIDTH);
    }
  });
});
