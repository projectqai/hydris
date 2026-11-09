import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

import { useBullseyeStore } from "./bullseye-store";
import { useEditStore } from "./edit-store";
import { usePathStore } from "./path-store";
import { standDownModes } from "./stand-down";

const A = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } } as const;
const B = { type: "coordinate", position: { lat: 52.4, lng: -1.2 } } as const;

function armEverything() {
  useEditStore.getState().start("range-1", "range", [A, B]);
  useEditStore.getState().movePoint(0, { type: "coordinate", position: { lat: 52, lng: -1 } });

  usePathStore.getState().start("freeform");
  usePathStore.getState().addPoint(A);

  useBullseyeStore.getState().togglePlacing();
  useBullseyeStore.getState().setCenter(51.9, -1.7);
}

describe("standDownModes", () => {
  beforeEach(() => {
    useEditStore.setState({
      entityId: null,
      points: [],
      rings: undefined,
      radiusM: undefined,
      history: [],
    });
    usePathStore.setState({ paths: [], drawingId: null });
    useBullseyeStore.setState({ center: null, isPlacing: false });
  });

  // Without this, every assertion below would also pass on an idle store.
  it("arms every mode before the stand-down, or the assertions are vacuous", () => {
    armEverything();

    expect(useEditStore.getState().entityId).toBe("range-1");
    expect(usePathStore.getState().drawingId).not.toBeNull();
    expect(useBullseyeStore.getState().center).not.toBeNull();
  });

  it.each([
    ["an edit", () => useEditStore.getState().entityId],
    ["a path", () => usePathStore.getState().drawingId],
    ["a bullseye centre", () => useBullseyeStore.getState().center],
  ])("stands down %s", (_mode, read) => {
    armEverything();
    standDownModes();

    expect(read()).toBeNull();
  });

  // Disarming leaves the placed points drawing, with no bar left to finish them.
  it("leaves no local path behind for a mode it stood down", () => {
    armEverything();
    standDownModes();

    expect(usePathStore.getState().paths).toEqual([]);
  });
});
