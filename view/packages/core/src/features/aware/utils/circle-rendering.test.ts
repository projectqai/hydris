import { create } from "@bufbuild/protobuf";
import {
  drawingPreviewFeatures,
  drawingPreviewForPath,
} from "@hydris/map-engine/geometry/drawing-preview";
import type { GeoPosition, PathPoint, ShapeFeature } from "@hydris/map-engine/types";
import { EntitySchema } from "@projectqai/proto/world";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

import { shapeToFeatures } from "../../../../../map-engine/src/utils/shape-to-geojson";
import { CONTROLLER_ID } from "../../../lib/api/controller-id";
import { writeDrawing } from "../../../lib/api/write-drawing";
import { buildPathLayerData } from "./path-layer-data";
import { readDrawing, transformEntity } from "./transform-entities";

function fillContains(features: ShapeFeature[], point: GeoPosition): boolean {
  return features.some((feature) => {
    if (feature.geometry.type !== "Polygon") return false;
    const contained = feature.geometry.coordinates.map((ring) => {
      let inside = false;
      for (const [index, vertex] of ring.entries()) {
        const previous = ring[(index + ring.length - 1) % ring.length];
        const [x = NaN, y = NaN] = vertex;
        const [px = NaN, py = NaN] = previous ?? [];
        if (
          y > point.lat !== py > point.lat &&
          point.lng < ((px - x) * (point.lat - y)) / (py - y) + x
        ) {
          inside = !inside;
        }
      }
      return inside;
    });
    return contained[0] === true && !contained.slice(1).some(Boolean);
  });
}

const probes: GeoPosition[] = [
  { lat: 85, lng: 37 },
  { lat: -85, lng: 37 },
  { lat: 40, lng: 37 },
  { lat: 0, lng: 37 },
  { lat: 0, lng: -143 },
  { lat: 60, lng: 179 },
  { lat: -60, lng: -179 },
  { lat: 74, lng: -179 },
  { lat: 74, lng: 179 },
  { lat: 74, lng: 0 },
];

// Independent WGS84 direct/inverse references: bearing 37°, with membership
// determined by the inverse distance from the centre to each probe.
const circles = [
  {
    name: "centred on the north pole",
    centre: { lat: 90, lng: 37 },
    edge: { lat: 54.14419394332334, lng: 180 },
    radiusM: 4_000_000,
    inside: [true, false, false, false, false, true, false, true, true, true],
  },
  {
    name: "north pole",
    centre: { lat: 70, lng: 37 },
    edge: { lat: 67.1849094794285, lng: 151.69164865327906 },
    radiusM: 4_000_000,
    inside: [true, false, true, false, false, false, false, true, true, true],
  },
  {
    name: "south pole",
    centre: { lat: -62, lng: -111 },
    edge: { lat: -21.047002472214807, lng: -83.92901319989394 },
    radiusM: 5_000_000,
    inside: [false, true, false, false, false, false, true, false, false, false],
  },
  {
    name: "north pole beyond a hemisphere",
    centre: { lat: 70, lng: 37 },
    edge: { lat: 7.174013763384036, lng: -179.8771100485098 },
    radiusM: 11_000_000,
    inside: [true, false, true, true, false, true, false, true, true, true],
  },
  {
    name: "both poles with a seam-crossing excluded region",
    centre: { lat: 12, lng: 37 },
    edge: { lat: 30.764536530261605, lng: -177.7274279725145 },
    radiusM: 14_000_000,
    inside: [true, true, true, true, false, true, true, true, true, true],
  },
  {
    name: "both poles with an uncut excluded region",
    centre: { lat: 12, lng: 179 },
    edge: { lat: 30.764536530261605, lng: -35.72742797251453 },
    radiusM: 14_000_000,
    inside: [true, true, true, false, true, true, true, true, true, true],
  },
  {
    name: "date line without a pole",
    centre: { lat: 73.2, lng: 178.4 },
    edge: { lat: 75.58399013471225, lng: -174.00518203166678 },
    radiusM: 350_000,
    inside: [false, false, false, false, false, false, false, true, true, false],
  },
];

describe("circle rendering", () => {
  it("retains sampled geometry when layer vertices are rebuilt for a circle", () => {
    const points: PathPoint[] = [
      { type: "coordinate", position: { lat: 70, lng: 19 } },
      { type: "coordinate", position: { lat: 70.4, lng: 21.7 } },
    ];

    const path = { id: "outline", kind: "circle" as const, points, rings: 3 };
    const viewport = { west: 10, east: 32, south: 65, north: 76 };
    const first = buildPathLayerData(path, new Map(), new Map());
    const features = drawingPreviewFeatures({ path: first, zoom: 7.3, viewport });
    const next = buildPathLayerData(path, new Map(), new Map());
    expect(next.vertices).not.toBe(first.vertices);
    const repeated = drawingPreviewFeatures({ path: next, zoom: 7.3, viewport });
    expect(features.length).toBeGreaterThan(0);
    expect(repeated).toHaveLength(features.length);
    repeated.forEach((feature, index) => expect(feature.geometry).toBe(features[index]?.geometry));

    points[1] = { type: "coordinate", position: { lat: 70.6, lng: 22.1 } };

    const edited = drawingPreviewFeatures({
      path: buildPathLayerData(path, new Map(), new Map()),
      zoom: 7.3,
      viewport,
    });

    expect(edited.map((feature) => feature.geometry)).not.toEqual(
      features.map((feature) => feature.geometry),
    );
  });

  it.each(circles)("fills the measured region: $name", ({ centre, edge, radiusM, inside }) => {
    const points: PathPoint[] = [
      { type: "coordinate", position: centre },
      { type: "coordinate", position: edge },
    ];
    const entity = create(EntitySchema, {
      id: "circle",
      controller: { id: CONTROLLER_ID },
      shape: writeDrawing("circle", points),
    });
    const drawing = readDrawing(entity);
    expect(drawing?.kind, "stored circle remains a circle, not a freeform").toBe("circle");
    expect(drawing?.radiusM, "stored radius matches the independent direct solution").toBeCloseTo(
      radiusM,
      6,
    );
    if (!drawing) throw new Error("missing circle drawing");
    const data = buildPathLayerData({ id: entity.id, ...drawing }, new Map(), new Map());
    expect(data.segments[0]?.groundDistanceM).toBeCloseTo(radiusM, 6);
    expect(data.totals.some((total) => total.label.startsWith("Σ"))).toBe(false);
    for (const [index, probe] of probes.entries()) {
      const viewport = {
        west: probe.lng - 0.001,
        east: probe.lng + 0.001,
        south: probe.lat - 0.001,
        north: probe.lat + 0.001,
      };
      const shape = drawingPreviewForPath({ ...data, zoom: 19, viewport });
      if (!shape) throw new Error("missing viewport circle geometry");
      const features = shapeToFeatures(entity.id, shape, "unclassified", true);
      expect(fillContains(features, probe), `viewport fill at ${probe.lat},${probe.lng}`).toBe(
        inside[index],
      );
    }
    const storedShape = transformEntity(entity)?.shape;
    for (const shape of [
      storedShape,
      ...[0, 3].map((zoom) => drawingPreviewForPath({ ...data, zoom })),
    ]) {
      if (!shape) throw new Error("missing circle geometry");
      const features = shapeToFeatures(entity.id, shape, "unclassified", true);
      for (const [index, probe] of probes.entries()) {
        expect(
          fillContains(features, probe),
          `circle fill membership at ${probe.lat},${probe.lng} matches the reference distance`,
        ).toBe(inside[index]);
      }
      for (const feature of features) {
        const paths =
          feature.geometry.type === "Polygon"
            ? feature.geometry.coordinates
            : feature.geometry.type === "LineString"
              ? [feature.geometry.coordinates]
              : [];
        for (const path of paths) {
          for (const [index, point] of path.entries()) {
            const [lng = NaN, lat = NaN] = point;
            expect(Math.abs(lng)).toBeLessThanOrEqual(180);
            expect(Math.abs(lat)).toBeLessThanOrEqual(90);
            const previous = path[index - 1];
            if (previous) {
              expect(
                Math.abs(lng - (previous[0] ?? NaN)),
                "rendered edges do not jump across the world",
              ).toBeLessThanOrEqual(180);
            }
            if (feature.geometry.type === "LineString") {
              expect(
                Math.abs(lat),
                "polar closure is never stroked as part of the rim",
              ).toBeLessThan(90);
            }
          }
        }
      }
    }
  });
});
