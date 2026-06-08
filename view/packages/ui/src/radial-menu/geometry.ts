// Angles in radians: 0 = east, -PI/2 = north. Slice 0 at top, clockwise.

export type Point = { x: number; y: number };

const TAU = Math.PI * 2;

export function sliceAngles(index: number, count: number): { start: number; end: number } {
  const span = TAU / count;
  const start = -Math.PI / 2 - span / 2 + index * span;
  return { start, end: start + span };
}

export function sliceCenterAngle(index: number, count: number): number {
  const { start, end } = sliceAngles(index, count);
  return (start + end) / 2;
}

export function polar(r: number, angle: number): Point {
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

// A -- outer arc -- B
// |                 |
// D -- inner arc -- C
// gap = arcLen / R, so inner uses a wider angle than outer for the same pixel gap.
export function slicePath(
  index: number,
  count: number,
  innerR: number,
  outerR: number,
  gapPx: number,
  cornerR: number,
): string {
  const raw = sliceAngles(index, count);
  const sOut = raw.start + gapPx / 2 / outerR;
  const eOut = raw.end - gapPx / 2 / outerR;
  const sIn = raw.start + gapPx / 2 / innerR;
  const eIn = raw.end - gapPx / 2 / innerR;
  const largeArc = eOut - sOut > Math.PI ? 1 : 0;

  const A = polar(outerR, sOut);
  const B = polar(outerR, eOut);
  const C = polar(innerR, eIn);
  const D = polar(innerR, sIn);
  const arcStartA = polar(outerR, sOut + cornerR / outerR);
  const arcEndB = polar(outerR, eOut - cornerR / outerR);
  const lineStartB = polar(outerR - cornerR, eOut);
  const lineEndC = polar(innerR + cornerR, eIn);
  const arcStartC = polar(innerR, eIn - cornerR / innerR);
  const arcEndD = polar(innerR, sIn + cornerR / innerR);
  const lineStartD = polar(innerR + cornerR, sIn);
  const lineEndA = polar(outerR - cornerR, sOut);

  // SVG commands: M=move, A=arc, L=line, Q=quad curve (rounds a corner), Z=close.
  return [
    `M ${arcStartA.x} ${arcStartA.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${arcEndB.x} ${arcEndB.y}`,
    `Q ${B.x} ${B.y} ${lineStartB.x} ${lineStartB.y}`,
    `L ${lineEndC.x} ${lineEndC.y}`,
    `Q ${C.x} ${C.y} ${arcStartC.x} ${arcStartC.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${arcEndD.x} ${arcEndD.y}`,
    `Q ${D.x} ${D.y} ${lineStartD.x} ${lineStartD.y}`,
    `L ${lineEndA.x} ${lineEndA.y}`,
    `Q ${A.x} ${A.y} ${arcStartA.x} ${arcStartA.y}`,
    "Z",
  ].join(" ");
}

export function hitSlice(
  dx: number,
  dy: number,
  count: number,
  innerR: number,
  outerR: number,
  outerSlop = 80,
): number {
  "worklet"; // called from gesture worklets
  const r = Math.hypot(dx, dy);
  if (r < innerR || r > outerR + outerSlop) return -1;
  const span = TAU / count;
  const raw = Math.atan2(dy, dx) + Math.PI / 2 + span / 2;
  return Math.floor((((raw % TAU) + TAU) % TAU) / span);
}
