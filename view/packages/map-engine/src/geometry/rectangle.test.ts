import { describe, expect, it } from "vitest";

import { destinationDegrees } from "../utils/geodesic-circle";
import { ellipsoidPolygonArea, geodesicDistance, initialBearing } from "../utils/geodesy";
import { rectangleCorners } from "./rectangle";

const ORIGIN = { lat: 0, lng: 0 };
const EAST = { lat: 0, lng: 0.01 };

function sideLength(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return geodesicDistance(
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
  );
}

function interiorAngle(
  vertex: { lat: number; lng: number },
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
) {
  const from = { latitude: vertex.lat, longitude: vertex.lng };
  const firstBearing = initialBearing(from, { latitude: first.lat, longitude: first.lng });
  const secondBearing = initialBearing(from, { latitude: second.lat, longitude: second.lng });
  const difference = Math.abs(firstBearing - secondBearing);
  return Math.min(difference, 360 - difference);
}

describe("rectangleCorners", () => {
  it("takes the depth square to the first edge, not the raw distance", () => {
    // the third tap is offset along the edge as well as away from it, and only
    // the perpendicular part counts
    const square = rectangleCorners(ORIGIN, EAST, { lat: 0.005, lng: 0.01 });
    const skewed = rectangleCorners(ORIGIN, EAST, { lat: 0.005, lng: 0.05 });

    expect(sideLength(skewed[1]!, skewed[2]!)).toBeCloseTo(sideLength(square[1]!, square[2]!), 3);
  });

  it("builds on whichever side of the edge the third tap fell", () => {
    const north = rectangleCorners(ORIGIN, EAST, { lat: 0.005, lng: 0.01 });
    const south = rectangleCorners(ORIGIN, EAST, { lat: -0.005, lng: 0.01 });

    expect(north[3]!.lat).toBeGreaterThan(0);
    expect(south[3]!.lat).toBeLessThan(0);
  });

  it("erects both base corners square to a wide off-axis geodesic", () => {
    const first = { lat: 70, lng: 10 };
    const second = destinationDegrees(first, 37.4, 100_000);
    const depth = destinationDegrees(second, 123.7, 60_000);
    const [a, b, c, d] = rectangleCorners(first, second, depth);

    expect(interiorAngle(a, b, d)).toBeCloseTo(90, 10);
    expect(interiorAngle(b, a, c)).toBeCloseTo(90, 10);
  });
});

// The readouts a rectangle publishes have to agree with the shape it draws, so
// its area is the one its own corners enclose rather than two sides multiplied.
describe("rectangle area", () => {
  const corners = rectangleCorners(ORIGIN, EAST, { lat: 0.005, lng: 0.01 });
  const ring = [...corners, corners[0]].map((c) => ({ latitude: c.lat, longitude: c.lng }));

  it("matches the sides it reports, to within a thousandth", () => {
    const width = sideLength(corners[0], corners[1]);
    const depth = sideLength(corners[1], corners[2]);
    const enclosed = ellipsoidPolygonArea(ring);

    expect(enclosed / (width * depth)).toBeCloseTo(1, 3);
  });
});
