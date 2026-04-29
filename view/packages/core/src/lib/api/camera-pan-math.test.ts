import { describe, expect, it } from "vitest";

import { nextAzimuth } from "./camera-pan-math";

describe("nextAzimuth", () => {
  it("returns null for non-finite fractions", () => {
    expect(nextAzimuth(85.2, NaN)).toBeNull();
    expect(nextAzimuth(85.2, Infinity)).toBeNull();
    expect(nextAzimuth(85.2, -Infinity)).toBeNull();
  });

  it("returns null inside the center dead zone", () => {
    expect(nextAzimuth(85.2, 0)).toBeNull();
    expect(nextAzimuth(85.2, 0.04)).toBeNull();
    expect(nextAzimuth(85.2, -0.04)).toBeNull();
  });

  it("clamps fractions outside [-1, 1]", () => {
    expect(nextAzimuth(0, 5)).toBeCloseTo(10);
    expect(nextAzimuth(0, -5)).toBeCloseTo(350);
  });

  it("pans 10° right at fraction 1.0", () => {
    expect(nextAzimuth(85.2, 1.0)).toBeCloseTo(95.2);
  });

  it("pans 10° left at fraction -1.0", () => {
    expect(nextAzimuth(85.2, -1.0)).toBeCloseTo(75.2);
  });

  it("scales linearly between dead zone and edge", () => {
    expect(nextAzimuth(0, 0.5)).toBeCloseTo(5);
    expect(nextAzimuth(0, -0.5)).toBeCloseTo(355);
  });

  it("wraps across 360°", () => {
    expect(nextAzimuth(355, 1.0)).toBeCloseTo(5);
  });

  it("wraps across 0°", () => {
    expect(nextAzimuth(5, -1.0)).toBeCloseTo(355);
  });

  it("normalizes a starting azimuth that's already negative", () => {
    expect(nextAzimuth(-5, 0.5)).toBeCloseTo(0);
  });
});
