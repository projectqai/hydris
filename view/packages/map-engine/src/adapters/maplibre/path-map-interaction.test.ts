import { describe, expect, it, vi } from "vitest";

import { createPathLayers } from "../../layers/path-layer";
import type { LayerPath, PathVertex } from "../../layers/path-logic";
import {
  closingVertexOf,
  findPickedEntityId,
  findPickedShapeId,
  findPlacingPath,
  isSlippedClick,
  isVertexUnlocked,
  pathAnchors,
  resolveEntityLayerClick,
  resolveRangeMapCommit,
  shouldFinishOnDoubleClick,
  vertexPickRadius,
} from "./path-map-interaction";

const POINT = { x: 10, y: 10 };
const POSITION = { lat: 1, lng: 2 };
const EXISTING_VERTEX = { pathId: "drawing", sourceIndex: 0 };

describe("vertexPickRadius", () => {
  it("uses a fingertip-sized radius for touch input", () => {
    expect(vertexPickRadius(true)).toBe(20);
    expect(vertexPickRadius(false)).toBe(8);
  });
});

describe("shouldFinishOnDoubleClick", () => {
  it("refuses touch input for gesture-ending placements and open edits", () => {
    expect(shouldFinishOnDoubleClick("touch", true, false)).toBe(false);
    expect(shouldFinishOnDoubleClick("touch", false, true)).toBe(false);
  });

  it("keeps mouse and pen finishing for gesture-ending placements and open edits", () => {
    expect(shouldFinishOnDoubleClick("mouse", true, false)).toBe(true);
    expect(shouldFinishOnDoubleClick("pen", false, true)).toBe(true);
  });

  it("does nothing when no path needs finishing", () => {
    expect(shouldFinishOnDoubleClick("mouse", false, false)).toBe(false);
  });
});

describe("resolveEntityLayerClick", () => {
  it.each([
    ["refuses an entity for non-anchoring placement", "drawing", false, "entity", "refuse"],
    ["anchors an entity for range and bearing placement", "range", true, "entity", "anchor"],
    ["selects an entity with no active tool", "none", false, "entity", "select"],
    ["refuses a cluster for non-anchoring placement", "drawing", false, "cluster", "refuse"],
    ["places a coordinate for a range and bearing cluster", "range", true, "cluster", "place"],
    ["flies to a cluster with no active tool", "none", false, "cluster", "fly"],
  ] as const)("%s", (_name, activeTool, anchors, target, expected) => {
    expect(resolveEntityLayerClick(activeTool, anchors, target)).toBe(expected);
  });
});

describe("findPickedEntityId", () => {
  it("finds an entity underneath a free range vertex", () => {
    expect(
      findPickedEntityId([{ pathId: "path-1", sourceIndex: 0 }, { entity: { id: "entity-1" } }]),
    ).toBe("entity-1");
  });

  it("uses an anchored range vertex's entity", () => {
    expect(findPickedEntityId([{ entityId: "entity-1" }])).toBe("entity-1");
  });
});

describe("resolveRangeMapCommit", () => {
  // A pick that ignores its argument still finds an entity, so the point the
  // click landed on has to be the one asked about.
  it("anchors to an entity under the screen point", () => {
    const coordinateForPoint = vi.fn(() => POSITION);
    const pickEntityId = vi.fn((x: number, y: number) =>
      x === 30 && y === 42 ? "entity-1" : null,
    );

    expect(
      resolveRangeMapCommit({
        point: { x: 30, y: 42 },
        pickedPathVertex: null,
        drawnPathVertex: null,
        pickEntityId,
        coordinateForPoint,
      }),
    ).toEqual({ type: "point", point: { type: "entity", entityId: "entity-1" } });
    expect(pickEntityId).toHaveBeenCalledWith(30, 42);
    expect(coordinateForPoint).not.toHaveBeenCalled();
  });

  // Supplying both vertex sources lets either guard alone pass the test, so each
  // has to refuse the click on its own.
  it.each([
    ["picked", EXISTING_VERTEX, null],
    ["drawn", null, EXISTING_VERTEX],
  ])("ignores a click that lands on an existing %s vertex", (_name, picked, drawn) => {
    expect(
      resolveRangeMapCommit({
        point: POINT,
        pickedPathVertex: picked,
        drawnPathVertex: drawn,
        pickEntityId: () => null,
        coordinateForPoint: () => POSITION,
      }),
    ).toBeNull();
  });
});

const vertex = (sourceIndex: number): PathVertex => ({
  pathId: "drawing",
  position: { lat: sourceIndex, lng: 0 },
  sourceIndex,
  anchored: false,
  unresolved: false,
});

const path = (overrides: Partial<LayerPath> = {}): LayerPath => ({
  id: "drawing",
  kind: "freeform",
  vertices: [vertex(0), vertex(1), vertex(2)],
  segments: [],
  totals: [],
  closed: false,
  closable: true,
  verticesWhenLocked: false,
  ...overrides,
});

describe("findPickedShapeId", () => {
  it("identifies a rendered freeform fill through the existing shape picker", () => {
    const freeform = path({
      closed: true,
      vertices: [
        { ...vertex(0), position: { lat: 51.2, lng: -2.4 } },
        { ...vertex(1), position: { lat: 52.1, lng: 0.7 } },
        { ...vertex(2), position: { lat: 49.6, lng: 1.3 } },
      ],
    });
    const fill = createPathLayers({
      data: { paths: [freeform], drawingId: null },
      onPathClick: () => true,
    }).find((layer) => layer.id === "range-fills");
    if (!fill || !Array.isArray(fill.props.data)) throw new Error("Expected a rendered fill");

    expect(fill.props.pickable).toBe(true);
    expect(
      findPickedShapeId(fill.props.data[0]),
      "freeform fill must expose its entity to the shape picker",
    ).toBe("drawing");
  });
});

describe("findPlacingPath", () => {
  // A single-path fixture passes even when the id is ignored, so the placing path
  // has to be somewhere other than first.
  it("finds the path the drawing id names", () => {
    const paths = [path({ id: "finished" }), path({ id: "drawing" }), path({ id: "other" })];

    expect(findPlacingPath({ paths, drawingId: "drawing" })?.id).toBe("drawing");
  });

  it("finds nothing while no tool is placing", () => {
    expect(findPlacingPath({ paths: [path()], drawingId: null })).toBeNull();
    expect(findPlacingPath(null)).toBeNull();
  });
});

describe("pathAnchors", () => {
  it("refuses a path it cannot find, rather than reporting undefined", () => {
    expect(pathAnchors({ paths: [path({ anchors: true })], drawingId: null }, "missing")).toBe(
      false,
    );
    expect(pathAnchors(null, "drawing")).toBe(false);
  });

  it("answers for a path that is not the one being placed", () => {
    const data = { paths: [path({ id: "edited", anchors: true })], drawingId: null };

    expect(pathAnchors(data, "edited")).toBe(true);
  });
});

describe("closingVertexOf", () => {
  it("closes on the first vertex of the path being placed", () => {
    expect(closingVertexOf(path(), { pathId: "drawing", sourceIndex: 0 })).toEqual(vertex(0));
  });

  it("treats any other vertex as an ordinary point", () => {
    expect(closingVertexOf(path(), { pathId: "drawing", sourceIndex: 2 })).toBeNull();
  });

  it("refuses a path that is not closable yet", () => {
    expect(
      closingVertexOf(path({ closable: false }), { pathId: "drawing", sourceIndex: 0 }),
    ).toBeNull();
  });

  it("refuses the first vertex of some other path", () => {
    expect(closingVertexOf(path(), { pathId: "rb-1", sourceIndex: 0 })).toBeNull();
    expect(closingVertexOf(null, { pathId: "drawing", sourceIndex: 0 })).toBeNull();
    expect(closingVertexOf(path(), null)).toBeNull();
  });
});

describe("isVertexUnlocked", () => {
  const target = { pathId: "rb-1", sourceIndex: 0 };

  it("unlocks what is being placed and what is open for editing", () => {
    expect(isVertexUnlocked(target, "rb-1", null)).toBe(true);
    expect(isVertexUnlocked(target, null, "rb-1")).toBe(true);
  });

  it("keeps a finished shape locked", () => {
    expect(isVertexUnlocked(target, "other", "another")).toBe(false);
    expect(isVertexUnlocked(null, "rb-1", "rb-1")).toBe(false);
  });
});

describe("isSlippedClick", () => {
  it("accepts a short press that barely moved", () => {
    expect(isSlippedClick(120, 4)).toBe(true);
  });

  it("rejects a long press or a real drag", () => {
    expect(isSlippedClick(900, 4)).toBe(false);
    expect(isSlippedClick(120, 80)).toBe(false);
  });
});
