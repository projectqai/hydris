import type { Layer } from "@deck.gl/core";
import { describe, expect, it } from "vitest";

import type { EditKind } from "../types";
import {
  composePathLayers,
  createPathLayers,
  createRangeInteractionLayers,
  PATH_SEGMENT_LABEL_LAYER_ID,
  PATH_TOTAL_LABEL_LAYER_ID,
  PATH_VERTEX_LAYER_ID,
} from "./path-layer";
import type { PathLayerData } from "./path-logic";
import { createShapeLayer } from "./shape-layer";

const SOURCE = { lat: 67.2, lng: -43.8 };
const TARGET = { lat: 67.3, lng: -43.4 };

function pathData(kind: EditKind, drawingId: string | null = null): PathLayerData {
  return {
    paths: [
      {
        id: "path-1",
        kind,
        vertices: [
          {
            pathId: "path-1",
            position: SOURCE,
            sourceIndex: 0,
            anchored: false,
            unresolved: false,
          },
          {
            pathId: "path-1",
            position: TARGET,
            sourceIndex: 1,
            anchored: false,
            unresolved: false,
          },
        ],
        segments: [
          {
            pathId: "path-1",
            source: SOURCE,
            target: TARGET,
            sourceIndex: 0,
            sourceAnchored: false,
            targetAnchored: false,
            groundDistanceM: 9_500,
            position: { lat: 67.25, lng: -43.6 },
            label: "9.50 km GD · 161°T",
            bearingDegrees: 161,
            unresolved: false,
          },
        ],
        totals: [],
        closed: false,
        drawsAsPath: true,
        verticesWhenLocked: true,
      },
    ],
    drawingId,
  };
}

const ids = (layers: readonly Layer[]) => layers.map((layer) => layer.id);

function expectBefore(layerIds: string[], lower: string, upper: string): void {
  expect(layerIds.indexOf(lower), `${lower} renders before ${upper}`).toBeLessThan(
    layerIds.indexOf(upper),
  );
}

describe("path layer composition", () => {
  it("does not reorder a finished range without interaction layers", () => {
    const base = createPathLayers({ data: pathData("range") });

    expect(ids(composePathLayers(base, []))).toEqual(ids(base));
  });

  it("keeps a drawing preview above path strokes and below labels and vertices", () => {
    const base = createPathLayers({ data: pathData("rectangle", "path-1") });
    const preview = createShapeLayer({
      id: "drawing-preview",
      data: [],
      visible: true,
      selectedId: null,
      drawnColor: [80, 140, 255, 255],
      filled: false,
      pickable: false,
    });
    const layerIds = ids(composePathLayers(base, preview));

    expectBefore(layerIds, "range-lines", "drawing-preview-casing");
    expectBefore(layerIds, "drawing-preview-casing", "drawing-preview");
    expectBefore(layerIds, "drawing-preview", PATH_SEGMENT_LABEL_LAYER_ID);
    expectBefore(layerIds, "drawing-preview", PATH_VERTEX_LAYER_ID);
  });

  it("keeps range preview strokes below segment labels and preview text on top", () => {
    const base = createPathLayers({ data: pathData("range", "path-1") });
    const interaction = createRangeInteractionLayers({
      preview: { source: SOURCE, target: TARGET, label: "9.50 km GD" },
    });
    const layerIds = ids(composePathLayers(base, interaction));

    expectBefore(layerIds, "range-lines", "range-preview-casing");
    expectBefore(layerIds, "range-preview-casing", PATH_SEGMENT_LABEL_LAYER_ID);
    expectBefore(layerIds, "range-preview-line", PATH_SEGMENT_LABEL_LAYER_ID);
    expectBefore(layerIds, PATH_VERTEX_LAYER_ID, "range-preview-label");
    expectBefore(layerIds, PATH_TOTAL_LABEL_LAYER_ID, "range-preview-label");
  });

  it("preserves the fallback order when the base has no vertex layer", () => {
    const base = createPathLayers({ data: pathData("rectangle", "path-1") }).filter(
      (layer) => layer.id !== PATH_VERTEX_LAYER_ID,
    );
    const preview = createShapeLayer({
      id: "drawing-preview",
      data: [],
      visible: true,
      selectedId: null,
      drawnColor: [80, 140, 255, 255],
      filled: false,
      pickable: false,
    });

    expect(ids(composePathLayers(base, preview))).toEqual([...ids(base), ...ids(preview)]);
  });
});
