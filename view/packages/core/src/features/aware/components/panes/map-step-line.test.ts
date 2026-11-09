import type { EditKind } from "@hydris/map-engine/types";
import { describe, expect, it } from "vitest";

import { type MapStepLineState, resolveMapStepLine } from "./resolve-map-step-line";

const IDLE_STATE: MapStepLineState = {
  isPlacing: false,
  editEntityId: null,
  editKind: "range",
  isTouchInput: false,
  isBullseyePlacing: false,
  pathKind: null,
  pathPointCount: 0,
};

function pathState(kind: EditKind, pointCount: number, isTouchInput: boolean): MapStepLineState {
  return { ...IDLE_STATE, pathKind: kind, pathPointCount: pointCount, isTouchInput };
}

// restated by hand: importing the source strings would make this pass either way
const PATH_LINES = [
  {
    kind: "range",
    pointCount: 0,
    touch: "Tap the start point or a track",
    pointer: "Click the start point or a track",
  },
  {
    kind: "range",
    pointCount: 1,
    touch: "Tap the far point or a track",
    pointer: "Click the far point or a track",
  },
  {
    kind: "rb-circle",
    pointCount: 0,
    touch: "Tap the centre point",
    pointer: "Click the centre point",
  },
  {
    kind: "rb-circle",
    pointCount: 1,
    touch: "Tap to set the radius",
    pointer: "Click to set the radius",
  },
  {
    kind: "circle",
    pointCount: 0,
    touch: "Tap the centre point",
    pointer: "Click the centre point",
  },
  {
    kind: "circle",
    pointCount: 1,
    touch: "Tap the edge to set the radius",
    pointer: "Click the edge to set the radius",
  },
  {
    kind: "rectangle",
    pointCount: 0,
    touch: "Tap the first corner",
    pointer: "Click the first corner",
  },
  {
    kind: "rectangle",
    pointCount: 1,
    touch: "Tap the next corner",
    pointer: "Click the next corner",
  },
  {
    kind: "rectangle",
    pointCount: 2,
    touch: "Tap to set how deep",
    pointer: "Click to set how deep",
  },
  {
    kind: "freeform",
    pointCount: 0,
    touch: "Tap the first point",
    pointer: "Click the first point",
  },
  {
    kind: "freeform",
    pointCount: 1,
    touch: "Keep tapping to add points",
    pointer: "Keep clicking to add points",
  },
  {
    kind: "freeform",
    pointCount: 2,
    touch: "Tap the first point to close, or Finish for a line",
    pointer: "Click the first point to close, or Finish for a line",
  },
  {
    kind: "freeform",
    pointCount: 7,
    touch: "Tap the first point to close, or Finish for a line",
    pointer: "Click the first point to close, or Finish for a line",
  },
] as const satisfies readonly {
  kind: EditKind;
  pointCount: number;
  touch: string;
  pointer: string;
}[];

describe("resolveMapStepLine", () => {
  it("selects touch path copy from the number of placed points", () => {
    for (const { kind, pointCount, touch } of PATH_LINES) {
      expect(resolveMapStepLine(pathState(kind, pointCount, true))).toBe(touch);
    }
  });

  it("selects pointer path copy from the number of placed points", () => {
    for (const { kind, pointCount, pointer } of PATH_LINES) {
      expect(resolveMapStepLine(pathState(kind, pointCount, false))).toBe(pointer);
    }
  });

  it("uses placement, edit, bullseye, then path precedence", () => {
    const allActive: MapStepLineState = {
      ...pathState("rectangle", 2, true),
      isPlacing: true,
      editEntityId: "drawing-4",
      editKind: "freeform",
      isBullseyePlacing: true,
    };

    expect(resolveMapStepLine(allActive)).toBe("Pan the map, then Confirm");
    expect(resolveMapStepLine({ ...allActive, isPlacing: false })).toBe(
      "Drag a handle or hold a segment to add a point",
    );
    expect(resolveMapStepLine({ ...allActive, isPlacing: false, editEntityId: null })).toBe(
      "Tap to place the bullseye",
    );
    expect(
      resolveMapStepLine({
        ...allActive,
        isPlacing: false,
        editEntityId: null,
        isBullseyePlacing: false,
      }),
    ).toBe("Tap to set how deep");
  });

  it("uses pointer copy for the bullseye", () => {
    expect(resolveMapStepLine({ ...IDLE_STATE, isBullseyePlacing: true })).toBe(
      "Click to place the bullseye",
    );
  });

  it("uses the general edit instruction outside touch freeform edits", () => {
    expect(
      resolveMapStepLine({
        ...IDLE_STATE,
        editEntityId: "drawing-5",
        editKind: "freeform",
      }),
    ).toBe("Drag a handle");
    expect(
      resolveMapStepLine({
        ...IDLE_STATE,
        editEntityId: "drawing-6",
        editKind: "rectangle",
        isTouchInput: true,
      }),
    ).toBe("Drag a handle");
  });

  it("renders nothing when no operation is active", () => {
    expect(resolveMapStepLine(IDLE_STATE)).toBeNull();
  });
});
