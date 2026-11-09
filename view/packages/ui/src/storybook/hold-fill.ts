import { expect, waitFor } from "storybook/test";

const SLIVER_MAX = 0.5;
const NEARLY_FULL = 0.6;

function hiddenShare(length: string, width: number) {
  if (length.endsWith("%")) return parseFloat(length) / 100;

  return parseFloat(length) / width;
}

// A full clip computes to a single inset("0px").
function fillShown(fill: HTMLElement) {
  if (!fill.isConnected) throw new Error("The fill left the screen");

  const insets = /inset\(([^)]*)\)/.exec(getComputedStyle(fill).clipPath)?.[1]?.split(" ") ?? [];
  const right = insets[1] ?? insets[0];

  if (right === undefined) throw new Error("The fill has no inset clip");

  return 1 - hiddenShare(right, fill.offsetWidth);
}

export async function expectFillGrows(fill: HTMLElement) {
  let first = 0;

  await waitFor(
    () => {
      first = fillShown(fill);
      expect(first).toBeGreaterThan(0);
    },
    { interval: 16, timeout: 2_000 },
  );

  await expect(first).toBeLessThan(SLIVER_MAX);
  await waitFor(() => expect(fillShown(fill)).toBeGreaterThan(NEARLY_FULL), {
    interval: 16,
    timeout: 3_000,
  });
}

export async function expectFillFull(fill: HTMLElement) {
  await waitFor(() => expect(fillShown(fill)).toBe(1), { interval: 16, timeout: 2_000 });
}

export async function expectFillEmpty(fill: HTMLElement) {
  await expect(fillShown(fill)).toBe(0);
}

export async function expectFillShrinks(fill: HTMLElement) {
  await expect(fillShown(fill)).toBeGreaterThan(0);
  await waitFor(() => expect(fillShown(fill)).toBe(0));
}
