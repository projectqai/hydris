import { userEvent } from "storybook/test";

import { THUMB_SIZE } from "../controls/control-slider";

type Point = { clientX: number; clientY: number };

export function center(element: Element): Point {
  const rect = element.getBoundingClientRect();

  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

export function trackPoint(slider: HTMLElement, ratio: number): Point {
  const rect = slider.getBoundingClientRect();
  const travel = rect.width - THUMB_SIZE;

  return {
    clientX: rect.left + THUMB_SIZE / 2 + ratio * travel,
    clientY: rect.top + rect.height / 2,
  };
}

function elementAt(point: Point): Element {
  const target = document.elementFromPoint(point.clientX, point.clientY);

  if (!target) throw new Error(`Nothing under the pointer at ${point.clientX},${point.clientY}`);

  return target;
}

export async function tap(point: Point) {
  const target = elementAt(point);

  await userEvent.pointer([
    { target, coords: point, keys: "[MouseLeft>]" },
    { target, coords: point, keys: "[/MouseLeft]" },
  ]);
}

type DragOptions = {
  moveFrom?: Point;
  steps?: number;
  delay?: number;
};

export async function drag(from: Point, to: Point, options: DragOptions = {}) {
  const { moveFrom = from, steps = 10, delay = 50 } = options;
  const target = elementAt(from);
  const step = (i: number): Point => ({
    clientX: moveFrom.clientX + ((to.clientX - moveFrom.clientX) * i) / steps,
    clientY: moveFrom.clientY + ((to.clientY - moveFrom.clientY) * i) / steps,
  });

  await userEvent
    .setup({ delay })
    .pointer([
      { target, coords: from, keys: "[MouseLeft>]" },
      ...Array.from({ length: steps + 1 }, (_, i) => ({ target, coords: step(i) })),
      { target, coords: to, keys: "[/MouseLeft]" },
    ]);
}
