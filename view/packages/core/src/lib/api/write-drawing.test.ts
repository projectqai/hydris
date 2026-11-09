import type { EditKind, PathPoint } from "@hydris/map-engine/types";
import { destinationDegrees } from "@hydris/map-engine/utils/geodesic-circle";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

// resolving a live anchor reaches the entity store, which opens the world client
vi.mock("./world-client", () => ({ worldClient: {} }));

import { useEntityStore } from "../../features/aware/store/entity-store";
import { buildPathLayerData } from "../../features/aware/utils/path-layer-data";
import { writeDrawing, writeMetrics } from "./write-drawing";

const coordinate = (position: { lat: number; lng: number }) =>
  ({ type: "coordinate", position }) as const;

describe("writeMetrics, range distance", () => {
  it("names the ground distance when altitude makes slant range longer", () => {
    const points: PathPoint[] = [
      { type: "coordinate", position: { lat: 68.3, lng: 17.4, alt: 125 } },
      { type: "coordinate", position: { lat: 68.308, lng: 17.427, alt: 2425 } },
    ];
    const published = writeMetrics("range", points);
    const distance = published?.metrics[0];

    expect(published?.metrics.map((metric) => metric.label)).toEqual([
      "Ground Distance",
      "Bearing",
    ]);
    expect(distance).toMatchObject({
      id: 1,
      kind: MetricKind.MetricKindDistance,
      unit: MetricUnit.MetricUnitKilometer,
      val: { case: "double" },
    });
    expect(distance?.val.value).toBeGreaterThan(1.4);
    expect(distance?.val.value).toBeLessThan(1.5);
  });
});

describe("writeMetrics, bearing", () => {
  it("publishes zero for a just-west-of-north range, matching its map label", () => {
    const points = [coordinate({ lat: 68.3, lng: 17.4 }), coordinate({ lat: 68.38, lng: 17.3994 })];
    const rendered = buildPathLayerData(
      { id: "range-north", kind: "range", points },
      new Map(),
      new Map(),
    );
    const segment = rendered.segments[0];
    const bearing = writeMetrics("range", points)?.metrics.find(
      (metric) => metric.unit === MetricUnit.MetricUnitDegree,
    );

    expect(segment?.bearingDegrees).toBeGreaterThan(359.5);
    expect(segment?.bearingDegrees).toBeLessThan(360);
    expect(segment?.label).toMatch(/ · 000°T$/);
    expect(bearing?.val.value).toBe(0);
  });
});

describe("writeMetrics, rectangle", () => {
  const first = { lat: 0, lng: 0 };
  const second = destinationDegrees(first, 90, 50_000);

  const metrics = (third: { lat: number; lng: number }) =>
    Object.fromEntries(
      (
        writeMetrics("rectangle", [coordinate(first), coordinate(second), coordinate(third)])
          ?.metrics ?? []
      ).map((metric) => [metric.label, metric.val.value as number]),
    );

  // The third tap contributes only its distance square to the first edge, so a
  // skewed tap is 50 km from the corner while the rectangle is 35 km deep.
  it("publishes the depth the rectangle was built with, not the raw tap distance", () => {
    const skewed = metrics(destinationDegrees(second, 45, 50_000));

    expect(skewed["Depth"]).toBeCloseTo(35.355, 2);
  });

  // With both legs 50 km, measuring the wrong one still reads 50, so the third
  // tap is a different distance from the first edge.
  it("measures width along the first edge, not the tap leg", () => {
    const published = metrics(destinationDegrees(second, 45, 20_000));

    expect(published["Width"]).toBeCloseTo(50, 2);
    expect(published["Depth"]).toBeCloseTo(14.142, 2);
  });
});

// Without a kind, everything downstream groups as General.
describe("writeMetrics, kinds", () => {
  const kindsOf = (kind: EditKind, points: readonly PathPoint[], radiusM?: number) =>
    Object.fromEntries(
      (writeMetrics(kind, points, undefined, radiusM)?.metrics ?? []).map((metric) => [
        metric.label,
        metric.kind,
      ]),
    );

  it("marks a range's distance, and leaves its bearing unkinded", () => {
    const published = kindsOf("range", [
      coordinate({ lat: 48, lng: 11 }),
      coordinate({ lat: 48.5, lng: 11.4 }),
    ]);

    expect(published["Ground Distance"]).toBe(MetricKind.MetricKindDistance);
    // the enum has no bearing value
    expect(published["Bearing"]).toBeUndefined();
  });

  it.each([
    ["Radius", "circle" as const],
    ["Radius", "rb-circle" as const],
  ])("marks an anchored %s on a %s", (label, kind) => {
    const published = kindsOf(
      kind,
      [
        {
          type: "entity",
          entityId: "track-1",
          lastKnownPosition: { lat: 48, lng: 11 },
        },
        coordinate({ lat: 48.013, lng: 11.021 }),
      ],
      1234,
    );

    expect(published[label]).toBe(MetricKind.MetricKindDistance);
  });

  // Both kinds on one shape: a single shared kind would pass every other case.
  it("marks a closed freeform's perimeter and area differently", () => {
    const corner = () => ({ lat: 48, lng: 11 });
    const published = kindsOf("freeform", [
      coordinate(corner()),
      coordinate({ lat: 48, lng: 11.02 }),
      coordinate({ lat: 48.01, lng: 11 }),
      coordinate(corner()),
    ]);

    expect(published["Perimeter"]).toBe(MetricKind.MetricKindDistance);
    expect(published["Area"]).toBe(MetricKind.MetricKindArea);
  });

  it("marks a rectangle's two lengths and its area", () => {
    const first = { lat: 48, lng: 11 };
    const second = destinationDegrees(first, 90, 50_000);
    const published = kindsOf("rectangle", [
      coordinate(first),
      coordinate(second),
      coordinate(destinationDegrees(second, 45, 50_000)),
    ]);

    expect(published["Width"]).toBe(MetricKind.MetricKindDistance);
    expect(published["Depth"]).toBe(MetricKind.MetricKindDistance);
    expect(published["Area"]).toBe(MetricKind.MetricKindArea);
  });
});

describe("writeDrawing, centre-and-radius shapes", () => {
  it.each(["circle", "rb-circle"] as const)("refuses a zero-radius %s", (kind) => {
    const point = coordinate({ lat: 48, lng: 11 });

    expect(() => writeDrawing(kind, [point, point])).toThrow(/positive radius/);
  });
});

describe("writeMetrics, range rings", () => {
  it("publishes the ring spacing, count, and outer radius", () => {
    const metrics = Object.fromEntries(
      (
        writeMetrics(
          "rb-circle",
          [coordinate({ lat: 48, lng: 11 }), coordinate({ lat: 48.01, lng: 11.01 })],
          4,
          1000,
        )?.metrics ?? []
      ).map((metric) => [metric.label, metric]),
    );

    expect(metrics["Radius"]?.val.value).toBe(1);
    expect(metrics["Radius"]?.unit).toBe(MetricUnit.MetricUnitKilometer);
    expect(metrics["Rings"]?.val.value).toBe(4);
    expect(metrics["Rings"]?.kind).toBe(MetricKind.MetricKindCount);
    expect(metrics["Outer Radius"]?.val.value).toBe(4);
    expect(metrics["Outer Radius"]?.unit).toBe(MetricUnit.MetricUnitKilometer);
  });
});

// An anchor dropped on an entity that then leaves the world before the shape is
// finished has no position at all: no live entity, and no snapshot yet.
describe("writeDrawing, an anchor lost before the shape was finished", () => {
  const far = coordinate({ lat: 48.5, lng: 11.4 });
  const lostAnchor = { type: "entity", entityId: "gone" } as const;

  const linePoints = (shape: ReturnType<typeof writeDrawing>) => {
    const plane = shape.geometry?.planar?.plane;
    return plane?.case === "line" ? plane.value.points : [];
  };

  beforeEach(() => useEntityStore.setState({ entities: new Map() }));

  it("refuses to write a range to null island", () => {
    expect(() => writeDrawing("range", [lostAnchor, far])).toThrow(/lost its entity/);
  });

  it.each(["circle", "rb-circle"] as const)("refuses to write a %s to null island", (kind) => {
    expect(() => writeDrawing(kind, [lostAnchor, far])).toThrow();
  });

  it("still writes the snapshot when the anchor left one behind", () => {
    const withSnapshot = {
      type: "entity",
      entityId: "gone",
      lastKnownPosition: { lat: 48, lng: 11 },
    } as const;

    const [first] = linePoints(writeDrawing("range", [withSnapshot, far]));

    expect(first?.latitude).toBeCloseTo(48, 9);
    expect(first?.longitude).toBeCloseTo(11, 9);
  });

  it("prefers the live entity to a stale snapshot", () => {
    useEntityStore.setState({
      entities: new Map([["gone", { id: "gone", geo: { latitude: 52, longitude: -1 } } as Entity]]),
    });
    const withSnapshot = {
      type: "entity",
      entityId: "gone",
      lastKnownPosition: { lat: 48, lng: 11 },
    } as const;

    const [first] = linePoints(writeDrawing("range", [withSnapshot, far]));

    expect(first?.latitude).toBeCloseTo(52, 9);
    expect(first?.longitude).toBeCloseTo(-1, 9);
  });
});
