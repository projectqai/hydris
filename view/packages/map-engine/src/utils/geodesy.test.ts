import { describe, expect, it } from "vitest";

import { ellipsoidPolygonArea, finalBearing, geodesicDistance, initialBearing } from "./geodesy";

function box(latitude: number, spanDegrees: number) {
  return [
    { latitude, longitude: 0 },
    { latitude, longitude: spanDegrees },
    { latitude: latitude + spanDegrees, longitude: spanDegrees },
    { latitude: latitude + spanDegrees, longitude: 0 },
  ];
}

describe("geodesicDistance", () => {
  // Expected distances are independent WGS-84 Vincenty reference values.
  it("matches 45 degrees at 30 km", () => {
    expect(
      geodesicDistance({ latitude: 52, longitude: 13 }, { latitude: 52.1905, longitude: 13.3093 }),
    ).toBeCloseTo(29_976.9, 1);
  });
});

describe("ellipsoidPolygonArea", () => {
  it("gives the same area whichever way the ring winds", () => {
    const ring = box(52, 0.01);

    expect(ellipsoidPolygonArea([...ring].reverse())).toBeCloseTo(ellipsoidPolygonArea(ring), 6);
  });
});

// Errors that scale with sin(latitude) are invisible at the equator and grow to
// whole degrees in the Arctic, so these fixtures are deliberately far north and
// off-axis.
describe("high latitude", () => {
  it("matches south-east at 78N", () => {
    const from = { latitude: 78.2, longitude: 15.6 };
    const to = { latitude: 78.05, longitude: 16.4 };

    expect(geodesicDistance(from, to)).toBeCloseTo(24_868.37, 1);
    expect(initialBearing(from, to)).toBeCloseTo(131.939_093, 4);
    expect(finalBearing(from, to)).toBeCloseTo(132.721_974, 4);
  });

  it("computes a true geodesic area for an Arctic quad", () => {
    // An irregular quad, so a naive width-by-height cannot coincide with the answer.
    const ring = [
      { latitude: 70.0, longitude: 25.0 },
      { latitude: 70.0, longitude: 26.0 },
      { latitude: 70.4, longitude: 26.3 },
      { latitude: 70.35, longitude: 25.1 },
    ];

    expect(ellipsoidPolygonArea(ring) / 1e6).toBeCloseTo(1_720.178_383, 2);
  });
});
