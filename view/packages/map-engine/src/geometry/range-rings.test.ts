import { describe, expect, it } from "vitest";

import { geodesicDistance, initialBearing } from "../utils/geodesy";
import { ringLabelPosition, ringRadii } from "./range-rings";

const CENTRE = { lat: 52, lng: 4 };
const toGeo = (p: { lat: number; lng: number }) => ({ latitude: p.lat, longitude: p.lng });

describe("ringRadii", () => {
  it("draws nothing without a radius or a count", () => {
    expect(ringRadii(0, 3)).toEqual([]);
    expect(ringRadii(50, 0)).toEqual([]);
  });
});

describe("ringLabelPosition", () => {
  it("sits exactly its own radius from the centre", () => {
    for (const radiusM of ringRadii(50, 3)) {
      const label = ringLabelPosition(CENTRE, radiusM);
      expect(geodesicDistance(toGeo(CENTRE), toGeo(label))).toBeCloseTo(radiusM, 3);
    }
  });

  it("sits due south, so the labels stack", () => {
    for (const radiusM of ringRadii(50, 3)) {
      const label = ringLabelPosition(CENTRE, radiusM);
      expect(initialBearing(toGeo(CENTRE), toGeo(label))).toBeCloseTo(180, 6);
    }
  });
});
