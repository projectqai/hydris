import { describe, expect, it } from "vitest";

import { shapeToFeatures } from "./shape-to-geojson";

describe("shapeToFeatures", () => {
  it("maps a polyline to a GeoJSON LineString", () => {
    const [feature] = shapeToFeatures(
      "open",
      {
        type: "polyline",
        points: [
          { lat: 48.7, lng: -1.8 },
          { lat: 50.4, lng: 0.2 },
          { lat: 49.1, lng: 2.6 },
        ],
      },
      "unclassified",
      true,
    );

    expect(feature?.geometry.type).toBe("LineString");
  });
});
