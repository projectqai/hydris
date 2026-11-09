import { describe, expect, it } from "vitest";

import type { PathLayerData } from "../layers/path-logic";
import type { EditKind, GeoPosition } from "../types";
import { destinationDegrees } from "../utils/geodesic-circle";
import { geodesicDistance, initialBearing } from "../utils/geodesy";
import {
  drawingPreviewFeatures,
  drawingPreviewForPath,
  drawingPreviewShape,
} from "./drawing-preview";

const ORIGIN = { lat: 0, lng: 0 };
const EAST = { lat: 0, lng: 0.01 };
const DRAWING_ID = "drawing";

function previewData(kind: EditKind, positions: GeoPosition[]): PathLayerData {
  return {
    drawingId: DRAWING_ID,
    paths: [
      {
        id: DRAWING_ID,
        kind,
        vertices: positions.map((position, sourceIndex) => ({
          pathId: DRAWING_ID,
          position,
          sourceIndex,
          anchored: false,
          unresolved: false,
        })),
        segments: [],
        totals: [],
        closed: false,
        verticesWhenLocked: false,
      },
    ],
  };
}

describe("drawingPreviewShape", () => {
  it("draws a circle through the hovered point", () => {
    const centre = { lat: 63, lng: 18 };
    const edge = destinationDegrees(centre, 37, 1_500);
    const shape = drawingPreviewShape("circle", [centre, edge]);
    const centreGeo = { latitude: centre.lat, longitude: centre.lng };
    const radius = geodesicDistance(centreGeo, {
      latitude: edge.lat,
      longitude: edge.lng,
    });

    expect(shape?.type).toBe("polygon");
    const outer = shape?.type === "polygon" ? shape.outer : [];
    const bearingQuadrants = new Set<number>();
    for (const point of outer) {
      const pointGeo = { latitude: point.lat, longitude: point.lng };
      expect(geodesicDistance(centreGeo, pointGeo)).toBeCloseTo(radius, 3);
      bearingQuadrants.add(Math.floor(initialBearing(centreGeo, pointGeo) / 90) % 4);
    }
    expect(bearingQuadrants, "circle vertices span all four bearing quadrants").toEqual(
      new Set([0, 1, 2, 3]),
    );
  });

  it("refuses a zero radius, which would be a degenerate ring", () => {
    expect(drawingPreviewShape("circle", [ORIGIN, ORIGIN])).toBeNull();
  });

  it("shows a rectangle's first edge before its depth is known", () => {
    expect(drawingPreviewShape("rectangle", [ORIGIN, EAST])).toEqual({
      type: "polyline",
      points: [ORIGIN, EAST],
    });
  });

  it("closes the rectangle ring once the depth is hovered", () => {
    const shape = drawingPreviewShape("rectangle", [ORIGIN, EAST, { lat: 0.005, lng: 0.01 }]);
    const outer = shape?.type === "polygon" ? shape.outer : [];

    expect(outer).toHaveLength(5);
    expect(outer[0]).toEqual(outer[4]);
  });
});

describe("drawingPreviewFeatures", () => {
  const first = { lat: 37.317, lng: -122.081 };
  const second = { lat: 37.344, lng: -122.019 };
  const aim = { lat: 37.291, lng: -121.973 };
  const otherAim = { lat: 37.386, lng: -122.047 };

  it("does not build preview features for a range", () => {
    expect(drawingPreviewFeatures({ data: previewData("range", [first, second]), aim })).toEqual(
      [],
    );
  });

  it("builds drawing features from the placed vertices and aim", () => {
    const data = previewData("rectangle", [first, second]);
    const features = drawingPreviewFeatures({ data, aim });

    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toMatchObject({ id: DRAWING_ID, drawn: true });
    expect(features[0]?.geometry.type).toBe("Polygon");
    expect(features).not.toEqual(drawingPreviewFeatures({ data, aim: otherAim }));
  });

  it("does not build preview features when no path is being placed", () => {
    const data = previewData("rectangle", [first, second]);
    expect(drawingPreviewFeatures({ data: { ...data, drawingId: null }, aim })).toEqual([]);
  });
});

describe("drawingPreviewShape, ring set", () => {
  it("draws the requested rings at whole multiples of the placed radius", () => {
    const edge = destinationDegrees(ORIGIN, 90, 1000);
    const shape = drawingPreviewForPath({
      kind: "rb-circle",
      vertices: [{ position: ORIGIN }],
      rings: 4,
      aim: edge,
    });
    const geometries = shape?.type === "collection" ? shape.geometries : [];

    expect(geometries).toHaveLength(4);
    expect(
      geometries.map((geometry) => {
        const point = geometry.type === "polygon" ? geometry.outer[0] : undefined;
        if (!point) return 0;
        return geodesicDistance(
          { latitude: ORIGIN.lat, longitude: ORIGIN.lng },
          { latitude: point.lat, longitude: point.lng },
        );
      }),
    ).toEqual([
      expect.closeTo(1000, 3),
      expect.closeTo(2000, 3),
      expect.closeTo(3000, 3),
      expect.closeTo(4000, 3),
    ]);
  });
});

describe("drawingPreviewShape, freeform", () => {
  const A = { lat: 0, lng: 0 };
  const B = { lat: 0, lng: 1 };

  // the path layer draws it from the same points, so a preview here would be a
  // second, straighter copy on top of the first
  it("leaves the drawing to the path layer", () => {
    expect(drawingPreviewShape("freeform", [A, B])).toBeNull();
  });
});
