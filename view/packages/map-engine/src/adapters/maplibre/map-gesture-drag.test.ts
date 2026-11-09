// @vitest-environment jsdom

import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { setupMapGestureDrag } from "./map-gesture-drag";
import { resolveClaimedVertexTap } from "./path-map-interaction";

type ScreenPoint = {
  x: number;
  y: number;
};

type HarnessOptions = {
  canvas?: HTMLCanvasElement;
  hitTest?: (point: ScreenPoint) => string | null;
};

type TestPointerEventInit = {
  pointerId: number;
  pointerType: string;
  button?: number;
  clientX?: number;
  clientY?: number;
};

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(type: string, { pointerId, pointerType, ...init }: TestPointerEventInit) {
    super(type, { bubbles: true, ...init });
    this.pointerId = pointerId;
    this.pointerType = pointerType;
  }
}

function createGestureCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.setPointerCapture = () => {
    throw new DOMException("Pointer is not active", "NotFoundError");
  };
  canvas.hasPointerCapture = () => false;
  canvas.releasePointerCapture = () => {};
  return canvas;
}

function createHarness({
  canvas = createGestureCanvas(),
  hitTest = () => "vertex-1",
}: HarnessOptions = {}) {
  const map = {
    getCanvas: () => canvas,
    unproject: () => ({ lat: 12, lng: 34 }),
  } as unknown as MapLibreMap;
  const onTap =
    vi.fn<
      (
        target: string,
        coordinate: { point: ScreenPoint; position: { lat: number; lng: number } },
      ) => void
    >();
  const onMove =
    vi.fn<
      (
        target: string,
        coordinate: { point: ScreenPoint; position: { lat: number; lng: number } },
      ) => void
    >();
  const onRelease =
    vi.fn<
      (
        target: string,
        coordinate: { point: ScreenPoint; position: { lat: number; lng: number } },
      ) => void
    >();
  const cleanup = setupMapGestureDrag({ map, hitTest, onTap, onMove, onRelease });

  return { canvas, cleanup, hitTest, onMove, onRelease, onTap };
}

function dispatchPointer(
  canvas: HTMLCanvasElement,
  type: string,
  {
    pointerId = 1,
    pointerType = "mouse",
    clientX = 10,
    clientY = 20,
    button = 0,
  }: Partial<TestPointerEventInit> = {},
): TestPointerEvent {
  const event = new TestPointerEvent(type, {
    pointerId,
    pointerType,
    clientX,
    clientY,
    button,
  });
  canvas.dispatchEvent(event);
  return event;
}

describe("setupMapGestureDrag", () => {
  it("reports the pointerdown coordinate for a tap within the drag slop", () => {
    const { canvas, onMove, onRelease, onTap } = createHarness();

    dispatchPointer(canvas, "pointerdown");
    dispatchPointer(canvas, "pointerup", { clientX: 12 });

    expect(onTap).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledWith("vertex-1", {
      point: { x: 10, y: 20 },
      position: { lat: 12, lng: 34 },
    });
    expect(onMove).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("treats movement past the slop as a move followed by release", () => {
    const calls: string[] = [];
    const { canvas, onMove, onRelease, onTap } = createHarness();
    onMove.mockImplementation(() => calls.push("move"));
    onRelease.mockImplementation(() => calls.push("release"));

    dispatchPointer(canvas, "pointerdown", { clientX: 10, clientY: 20 });
    dispatchPointer(canvas, "pointermove", { clientX: 15, clientY: 20 });
    dispatchPointer(canvas, "pointerup", { clientX: 15, clientY: 20 });

    expect(calls).toEqual(["move", "release"]);
    expect(onMove).toHaveBeenCalledWith("vertex-1", {
      point: { x: 15, y: 20 },
      position: { lat: 12, lng: 34 },
    });
    expect(onRelease).toHaveBeenCalledWith("vertex-1", {
      point: { x: 15, y: 20 },
      position: { lat: 12, lng: 34 },
    });
    expect(onTap).not.toHaveBeenCalled();
  });

  it("reports the pointerup coordinate on release", () => {
    const { canvas, onRelease } = createHarness();

    dispatchPointer(canvas, "pointerdown", { clientX: 10, clientY: 20 });
    dispatchPointer(canvas, "pointermove", { clientX: 15, clientY: 20 });
    dispatchPointer(canvas, "pointerup", { clientX: 18, clientY: 24 });

    expect(onRelease).toHaveBeenCalledWith("vertex-1", {
      point: { x: 18, y: 24 },
      position: { lat: 12, lng: 34 },
    });
  });

  describe("mouse slop", () => {
    const cases = [
      { name: "boundary: 0² + 4² = 16 = 4²", dx: 0, dy: 4, dragging: false },
      { name: "above: 3² + 3² = 18 > 4² = 16", dx: 3, dy: 3, dragging: true },
    ];

    it.each(cases)("uses the 4 px threshold $name", ({ dx, dy, dragging }) => {
      const { canvas, onMove, onRelease, onTap } = createHarness();

      dispatchPointer(canvas, "pointerdown", { clientX: 10, clientY: 20 });
      dispatchPointer(canvas, "pointermove", { clientX: 10 + dx, clientY: 20 + dy });
      dispatchPointer(canvas, "pointerup", { clientX: 10 + dx, clientY: 20 + dy });

      expect(onMove).toHaveBeenCalledTimes(dragging ? 1 : 0);
      expect(onRelease).toHaveBeenCalledTimes(dragging ? 1 : 0);
      expect(onTap).toHaveBeenCalledTimes(dragging ? 0 : 1);
    });
  });

  describe("touch slop", () => {
    const cases = [
      { name: "boundary: 0² + 8² = 64 = 8²", dx: 0, dy: 8, dragging: false },
      { name: "above: 6² + 6² = 72 > 8² = 64", dx: 6, dy: 6, dragging: true },
    ];

    it.each(cases)("uses the 8 px threshold $name", ({ dx, dy, dragging }) => {
      const { canvas, onMove, onRelease, onTap } = createHarness();

      dispatchPointer(canvas, "pointerdown", {
        pointerType: "touch",
        clientX: 10,
        clientY: 20,
      });
      dispatchPointer(canvas, "pointermove", {
        pointerType: "touch",
        clientX: 10 + dx,
        clientY: 20 + dy,
      });
      dispatchPointer(canvas, "pointerup", {
        pointerType: "touch",
        clientX: 10 + dx,
        clientY: 20 + dy,
      });

      expect(onMove).toHaveBeenCalledTimes(dragging ? 1 : 0);
      expect(onRelease).toHaveBeenCalledTimes(dragging ? 1 : 0);
      expect(onTap).toHaveBeenCalledTimes(dragging ? 0 : 1);
    });
  });

  it("lets pointerdown bubble but stops mousedown after claiming a mouse press", () => {
    const wrapper = document.createElement("div");
    const { canvas } = createHarness();
    const pointerDownBubbled = vi.fn();
    const mouseDownBubbled = vi.fn();
    wrapper.append(canvas);
    wrapper.addEventListener("pointerdown", pointerDownBubbled);
    wrapper.addEventListener("mousedown", mouseDownBubbled);

    dispatchPointer(canvas, "pointerdown");
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(pointerDownBubbled).toHaveBeenCalledOnce();
    expect(mouseDownBubbled).not.toHaveBeenCalled();
  });

  it("lets pointerdown bubble but stops touchstart after claiming a touch press", () => {
    const wrapper = document.createElement("div");
    const { canvas } = createHarness();
    const pointerDownBubbled = vi.fn();
    const touchStartBubbled = vi.fn();
    wrapper.append(canvas);
    wrapper.addEventListener("pointerdown", pointerDownBubbled);
    wrapper.addEventListener("touchstart", touchStartBubbled);

    dispatchPointer(canvas, "pointerdown", { pointerType: "touch" });
    canvas.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));

    expect(pointerDownBubbled).toHaveBeenCalledOnce();
    expect(touchStartBubbled).not.toHaveBeenCalled();
  });

  it("gives a claimed touch range tap to onTap without starting the map click route", () => {
    const wrapper = document.createElement("div");
    const { canvas, onTap } = createHarness();
    const commits: string[] = [];
    wrapper.append(canvas);
    wrapper.addEventListener("touchstart", () => commits.push("map"));
    onTap.mockImplementation(() => {
      if (resolveClaimedVertexTap("range") === "commit-range") commits.push("gesture");
    });

    dispatchPointer(canvas, "pointerdown", { pointerType: "touch" });
    canvas.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    dispatchPointer(canvas, "pointerup", { pointerType: "touch" });

    expect(commits).toEqual(["gesture"]);
  });

  it("stops nothing and fires no callback for an unclaimed press", () => {
    const wrapper = document.createElement("div");
    const hitTest = vi.fn(() => null);
    const { canvas, onMove, onRelease, onTap } = createHarness({ hitTest });
    const bubbled: string[] = [];
    wrapper.append(canvas);
    for (const type of ["pointerdown", "mousedown", "touchstart"]) {
      wrapper.addEventListener(type, () => bubbled.push(type));
    }

    dispatchPointer(canvas, "pointerdown");
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    canvas.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    dispatchPointer(canvas, "pointermove", { clientX: 20 });
    dispatchPointer(canvas, "pointerup", { clientX: 20 });

    expect(bubbled).toEqual(["pointerdown", "mousedown", "touchstart"]);
    expect(hitTest).toHaveBeenCalledOnce();
    expect(onMove).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("releases a drag when its pointer is cancelled", () => {
    const { canvas, onMove, onRelease, onTap } = createHarness();

    dispatchPointer(canvas, "pointerdown", { clientX: 10 });
    dispatchPointer(canvas, "pointermove", { clientX: 15 });
    dispatchPointer(canvas, "pointercancel", { clientX: 15 });

    expect(onMove).toHaveBeenCalledOnce();
    expect(onRelease).toHaveBeenCalledOnce();
    expect(onRelease).toHaveBeenCalledWith("vertex-1", {
      point: { x: 15, y: 20 },
      position: { lat: 12, lng: 34 },
    });
    expect(onTap).not.toHaveBeenCalled();
  });

  it("fires neither tap nor release when a press is cancelled before the slop", () => {
    const { canvas, onMove, onRelease, onTap } = createHarness();

    dispatchPointer(canvas, "pointerdown", { clientX: 10 });
    dispatchPointer(canvas, "pointermove", { clientX: 14 });
    dispatchPointer(canvas, "pointercancel", { clientX: 14 });

    expect(onMove).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it.each(["mouse", "pen"])("ignores a non-primary %s button", (pointerType) => {
    const hitTest = vi.fn(() => "vertex-1");
    const { canvas, onMove, onRelease, onTap } = createHarness({ hitTest });

    dispatchPointer(canvas, "pointerdown", { pointerType, button: 1 });
    dispatchPointer(canvas, "pointermove", { pointerType, button: 1, clientX: 20 });
    dispatchPointer(canvas, "pointerup", { pointerType, button: 1, clientX: 20 });

    expect(hitTest).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("ignores a second pointerdown while a gesture is active", () => {
    const hitTest = vi.fn((point: ScreenPoint) => `vertex-${point.x}`);
    const { canvas, onMove, onRelease, onTap } = createHarness({ hitTest });

    dispatchPointer(canvas, "pointerdown", { pointerId: 1, clientX: 10 });
    dispatchPointer(canvas, "pointerdown", { pointerId: 2, clientX: 20 });
    dispatchPointer(canvas, "pointermove", { pointerId: 2, clientX: 30 });
    dispatchPointer(canvas, "pointerup", { pointerId: 2, clientX: 30 });
    dispatchPointer(canvas, "pointerup", { pointerId: 1, clientX: 10 });

    expect(hitTest).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledWith("vertex-10", {
      point: { x: 10, y: 20 },
      position: { lat: 12, lng: 34 },
    });
    expect(onMove).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("cleanup removes every listener and abandons a gesture in flight", () => {
    const canvas = createGestureCanvas();
    const addEventListener = vi.spyOn(canvas, "addEventListener");
    const removeEventListener = vi.spyOn(canvas, "removeEventListener");
    const { cleanup, onMove, onRelease, onTap } = createHarness({ canvas });

    expect(addEventListener).toHaveBeenCalledTimes(6);
    dispatchPointer(canvas, "pointerdown", { clientX: 10 });
    cleanup();

    expect(removeEventListener).toHaveBeenCalledTimes(6);
    expect(removeEventListener.mock.calls).toEqual(addEventListener.mock.calls);

    dispatchPointer(canvas, "pointermove", { clientX: 20 });
    dispatchPointer(canvas, "pointerup", { clientX: 20 });
    dispatchPointer(canvas, "pointercancel", { clientX: 20 });
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    canvas.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));

    expect(onMove).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });
});
