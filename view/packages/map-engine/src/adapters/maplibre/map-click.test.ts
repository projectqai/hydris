import { describe, expect, it } from "vitest";

import type { MapClickInput, MapCursorInput } from "./path-map-interaction";
import { resolveMapClick, resolveMapCursor } from "./path-map-interaction";

// Nothing armed, nothing in flight, and a click on empty map.
const IDLE: MapClickInput = {
  activeTool: "none",
  isDragging: false,
  isAnimating: false,
  hasCoordinate: true,
  picked: false,
  msSinceLayerClick: 10_000,
};

const click = (over: Partial<MapClickInput> = {}) => resolveMapClick({ ...IDLE, ...over });

const IDLE_CURSOR: MapCursorInput = {
  activeTool: "none",
  editablePathId: null,
  anchors: false,
  picked: false,
  pickedAnchorableEntity: false,
  pickedPathVertex: false,
  dragging: false,
};

const cursor = (over: Partial<MapCursorInput> = {}) =>
  resolveMapCursor({ ...IDLE_CURSOR, ...over });

describe("map cursor", () => {
  it("describes idle clicks", () => {
    expect(cursor()).toBe("grab");
    expect(cursor({ picked: true, pickedAnchorableEntity: true })).toBe("pointer");
    expect(cursor({ picked: true })).toBe("pointer");
    expect(cursor({ picked: true, pickedPathVertex: true })).toBe("grab");
  });

  it("keeps a non-anchoring edit on grab", () => {
    const edit = { editablePathId: "shape-1" };

    expect(cursor(edit)).toBe("grab");
    expect(cursor({ ...edit, picked: true, pickedAnchorableEntity: true })).toBe("grab");
    expect(cursor({ ...edit, picked: true })).toBe("grab");
    expect(cursor({ ...edit, picked: true, pickedPathVertex: true })).toBe("grab");
  });

  it("points at an entity that an edited range and bearing can anchor to", () => {
    const edit = { editablePathId: "range-1", anchors: true };

    expect(cursor(edit)).toBe("grab");
    expect(cursor({ ...edit, picked: true, pickedAnchorableEntity: true })).toBe("pointer");
    expect(cursor({ ...edit, picked: true })).toBe("grab");
    expect(cursor({ ...edit, picked: true, pickedPathVertex: true })).toBe("grab");
  });

  it("describes range and bearing placement clicks", () => {
    const placement = { activeTool: "range" as const, anchors: true };

    expect(cursor(placement)).toBe("crosshair");
    expect(cursor({ ...placement, picked: true, pickedAnchorableEntity: true })).toBe("pointer");
    expect(cursor({ ...placement, picked: true })).toBe("crosshair");
    expect(cursor({ ...placement, picked: true, pickedPathVertex: true })).toBe("grab");
  });

  it("keeps drawing placement on a crosshair over non-actionable picks", () => {
    const placement = { activeTool: "drawing" as const };

    expect(cursor(placement)).toBe("crosshair");
    expect(cursor({ ...placement, picked: true, pickedAnchorableEntity: true })).toBe("crosshair");
    expect(cursor({ ...placement, picked: true })).toBe("crosshair");
    expect(cursor({ ...placement, picked: true, pickedPathVertex: true })).toBe("grab");
  });

  it.each([
    ["empty map", {}],
    ["path vertex", { picked: true, pickedPathVertex: true }],
  ])("stays grabbing while dragging over %s", (_name, pick) => {
    expect(cursor({ ...pick, dragging: true })).toBe("grabbing");
  });
});

describe("what a click means", () => {
  it("leaves the selection alone when something was under it", () => {
    expect(click({ picked: true })).toBe("ignore");
  });

  it("places a point for bullseye", () => {
    expect(click({ activeTool: "bullseye" })).toBe("commit-placement");
  });

  // A click only lacks a coordinate when it missed the globe entirely, and the
  // chain then falls through to the guards below it. Recorded because it is
  // surprising, not because it is wanted: a tool is armed and this deselects.
  it("falls through to a deselect when a click missed the globe", () => {
    expect(click({ activeTool: "drawing", hasCoordinate: false })).toBe("clear-selection");
  });
});

// Each of these is a guard that only works because of where it sits.
describe("the order the guards run in", () => {
  it("commits a range even mid-drag, since it resolves what is under the pointer", () => {
    expect(click({ activeTool: "range", isDragging: true })).toBe("commit-range");
  });

  it("drops the click that ends a pan, so a drag never places a point", () => {
    expect(click({ activeTool: "drawing", isDragging: true })).toBe("ignore");
  });

  it("places a point while the camera flies, where a deselect would be refused", () => {
    expect(click({ activeTool: "drawing", isAnimating: true })).toBe("commit-placement");
    expect(click({ isAnimating: true })).toBe("ignore");
  });

  it("treats a click just after a layer took one as that gesture's tail", () => {
    expect(click({ msSinceLayerClick: 499 })).toBe("ignore");
    expect(click({ msSinceLayerClick: 500 })).toBe("clear-selection");
  });

  it("places a point regardless of that tail, because placing is deliberate", () => {
    expect(click({ activeTool: "drawing", msSinceLayerClick: 0 })).toBe("commit-placement");
  });
});
