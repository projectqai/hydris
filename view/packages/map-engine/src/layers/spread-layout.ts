const CIRCLE_SPIRAL_SWITCHOVER = 10;
const CIRCLE_ITEM_SPACING = 65;
const SPIRAL_ITEM_SPACING = 28;
const SPIRAL_INITIAL_RADIUS = 30;
const SPIRAL_GROWTH_FACTOR = 10;

export type PixelOffset = [dx: number, dy: number];

export function computeSpreadOffsets(count: number): PixelOffset[] {
  if (count <= 1) return [[0, 0]];
  if (count <= CIRCLE_SPIRAL_SWITCHOVER) return circleOffsets(count);
  return spiralOffsets(count);
}

function circleOffsets(count: number): PixelOffset[] {
  const circumference = CIRCLE_ITEM_SPACING * (2 + count);
  const radius = circumference / (2 * Math.PI);
  const angleStep = (2 * Math.PI) / count;
  const offsets: PixelOffset[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * angleStep - Math.PI / 2;
    offsets.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return offsets;
}

function spiralOffsets(count: number): PixelOffset[] {
  const offsets: PixelOffset[] = [];
  let radius = SPIRAL_INITIAL_RADIUS;
  let angle = 0;
  for (let i = 0; i < count; i++) {
    angle += SPIRAL_ITEM_SPACING / radius + i * 0.0005;
    offsets.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    radius += (2 * Math.PI * SPIRAL_GROWTH_FACTOR) / angle;
  }
  return offsets;
}
