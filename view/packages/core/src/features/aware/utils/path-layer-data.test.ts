import { create } from "@bufbuild/protobuf";
import { drawingPreviewShape } from "@hydris/map-engine/geometry/drawing-preview";
import { rectangleCorners } from "@hydris/map-engine/geometry/rectangle";
import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import { destinationDegrees } from "@hydris/map-engine/utils/geodesic-circle";
import { geodesicMidpoint } from "@hydris/map-engine/utils/geodesic-path";
import { finalBearing, geodesicDistance } from "@hydris/map-engine/utils/geodesy";
import { EntitySchema } from "@projectqai/proto/world";
import { describe, expect, it, vi } from "vitest";

// writeMetrics reaches the entity store to resolve live anchors, which opens the
// world client on import
vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

import { CONTROLLER_ID } from "../../../lib/api/controller-id";
import { writeDrawing, writeMetrics } from "../../../lib/api/write-drawing";
import { buildPathLayerData } from "./path-layer-data";
import { readDrawing } from "./transform-entities";

const SOURCE = { lat: 0, lng: 0, alt: 0 };
const TARGET = { lat: 0.001, lng: 0, alt: 24 };

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return geodesicDistance(
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
  );
}

describe("path vertex visibility", () => {
  it.each([
    ["range", true],
    ["freeform", false],
  ] as const)("sets locked %s vertex visibility to %s", (kind, expected) => {
    const path: MapPath = { id: kind, kind, points: [] };

    expect(buildPathLayerData(path, new Map(), new Map()).verticesWhenLocked).toBe(expected);
  });
});

// Stored vertices arrive as their own objects, so every ring here closes on a
// fresh one. Repeating a single object would let closure be decided by
// reference and never compare the coordinates.
const corner = () => ({ lat: 0, lng: 0 });

describe("range total placement", () => {
  it("centres a closed ring's total without counting its repeated closing corner", () => {
    const path: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: { lat: 68, lng: 21 } },
        { type: "coordinate", position: { lat: 71, lng: 26 } },
        { type: "coordinate", position: { lat: 65, lng: 31 } },
        { type: "coordinate", position: { lat: 64, lng: 22 } },
        { type: "coordinate", position: { lat: 68, lng: 21 } },
      ],
    };

    // The four corners sum to (268, 100); counting the closure gives (336, 121) / 5.
    expect(buildPathLayerData(path, new Map(), new Map()).totals[0]?.position).toEqual({
      lat: 67,
      lng: 25,
    });
  });

  it("keeps an open path's total on its last point", () => {
    const path: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: { lat: 0, lng: 0 } },
        { type: "coordinate", position: { lat: 0, lng: 4 } },
        { type: "coordinate", position: { lat: 2, lng: 0 } },
      ],
    };

    expect(buildPathLayerData(path, new Map(), new Map()).totals[0]?.position).toEqual({
      lat: 2,
      lng: 0,
    });
  });
});

describe("range enclosed area", () => {
  const closedSquare: MapPath = {
    id: "path",
    kind: "range",
    points: [
      { type: "coordinate", position: corner() },
      { type: "coordinate", position: { lat: 0, lng: 0.01 } },
      { type: "coordinate", position: { lat: 0.01, lng: 0.01 } },
      { type: "coordinate", position: { lat: 0.01, lng: 0 } },
      { type: "coordinate", position: corner() },
    ],
  };

  // At the equator the WGS-84 surface element is a²(1−e²), so a 0.01° box
  // encloses a²(1−e²)·(0.01°)² = 1.231 km².
  it("appends the area to the total once the ring closes", () => {
    const result = buildPathLayerData(closedSquare, new Map(), new Map());

    expect(result.totals[0]?.label).toMatch(/ · 1\.23 km²$/);
  });

  it("leaves an open chain unfilled and without an area", () => {
    const open: MapPath = {
      id: "path",
      kind: "range",
      points: closedSquare.points.slice(0, -1),
    };
    const result = buildPathLayerData(open, new Map(), new Map());

    expect(result.closed).toBe(false);
    expect(result.totals[0]?.label).not.toMatch(/m²/);
  });

  it("reports no area for an outline that folds over itself", () => {
    // Corners two and four swapped, so the outline crosses in the middle.
    const bowtie: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: corner() },
        { type: "coordinate", position: { lat: 0, lng: 0.01 } },
        { type: "coordinate", position: { lat: 0.01, lng: 0 } },
        { type: "coordinate", position: { lat: 0.01, lng: 0.01 } },
        { type: "coordinate", position: corner() },
      ],
    };
    const result = buildPathLayerData(bowtie, new Map(), new Map());

    expect(result.closed).toBe(false);
    expect(result.totals[0]?.label).not.toMatch(/m²/);
  });

  it("keeps the area for a concave outline that never crosses", () => {
    const arrowhead: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: corner() },
        { type: "coordinate", position: { lat: 0.02, lng: 0.01 } },
        { type: "coordinate", position: { lat: 0, lng: 0.02 } },
        { type: "coordinate", position: { lat: 0.008, lng: 0.01 } },
        { type: "coordinate", position: corner() },
      ],
    };

    expect(buildPathLayerData(arrowhead, new Map(), new Map()).closed).toBe(true);
  });

  it("drops the area while an anchor is unresolved", () => {
    const anchored: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: corner() },
        { type: "coordinate", position: { lat: 0, lng: 0.01 } },
        { type: "entity", entityId: "missing" },
        { type: "coordinate", position: corner() },
      ],
    };
    const result = buildPathLayerData(anchored, new Map(), new Map());

    expect(result.closed).toBe(false);
  });
});

describe("range segment vertical rate", () => {
  // Level flight is a rate of zero, which is falsey. A non-zero fixture alone
  // cannot tell an omitted rate from one reported as zero.
  it.each([
    [-4, "113 m SR · 000°T · +12° · -4.0 m/s"],
    [0, "113 m SR · 000°T · +12° · +0.0 m/s"],
  ])("shows the far-end entity's vertical rate of %i", (rate, label) => {
    const path: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: SOURCE },
        { type: "entity", entityId: "target" },
      ],
    };

    const result = buildPathLayerData(
      path,
      new Map([["target", TARGET]]),
      new Map([["target", rate]]),
    );

    expect(result.segments[0]?.label).toBe(label);
  });

  it("omits the rate when the far-end entity does not report one", () => {
    const path: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "coordinate", position: SOURCE },
        { type: "entity", entityId: "target" },
      ],
    };

    const result = buildPathLayerData(path, new Map([["target", TARGET]]), new Map());

    expect(result.segments[0]?.label).toBe("113 m SR · 000°T · +12°");
  });

  it("ignores a moving source entity when the far end is static", () => {
    const path: MapPath = {
      id: "path",
      kind: "range",
      points: [
        { type: "entity", entityId: "source" },
        { type: "coordinate", position: TARGET },
      ],
    };

    const result = buildPathLayerData(
      path,
      new Map([["source", SOURCE]]),
      new Map([["source", -4]]),
    );

    expect(result.segments[0]?.label).toBe("113 m SR · 000°T · +12°");
  });
});

describe("anchored circle radius", () => {
  const drawn = { lat: 0, lng: 0 };
  const live = { lat: 1, lng: 1 };
  const centre = {
    type: "entity",
    entityId: "track-1",
    lastKnownPosition: drawn,
  } as const;

  it("uses the authoritative radius while the circle is displayed or idle in an edit", () => {
    const result = buildPathLayerData(
      {
        id: "circle-1",
        kind: "circle",
        points: [centre, { type: "coordinate", position: destinationDegrees(drawn, 90, 1000) }],
        radiusM: 1000,
      },
      new Map([["track-1", live]]),
      new Map(),
    );

    expect(result.segments[0]?.groundDistanceM).toBeCloseTo(1000, 6);
  });

  it("uses the edge handle after a drag clears the authoritative radius", () => {
    const result = buildPathLayerData(
      {
        id: "circle-1",
        kind: "circle",
        points: [centre, { type: "coordinate", position: destinationDegrees(live, 90, 2000) }],
      },
      new Map([["track-1", live]]),
      new Map(),
    );

    expect(result.segments[0]?.groundDistanceM).toBeCloseTo(2000, 6);
  });
});

describe("shapes that are not a path", () => {
  it("gives a rectangle no running total, since its points are corners", () => {
    const path: MapPath = {
      id: "path",
      kind: "rectangle",
      points: [
        { type: "coordinate", position: { lat: 0, lng: 0 } },
        { type: "coordinate", position: { lat: 0, lng: 0.01 } },
        { type: "coordinate", position: { lat: 0.005, lng: 0.01 } },
      ],
    };

    expect(buildPathLayerData(path, new Map(), new Map()).totals).toEqual([]);
  });
});

describe("range geometry from rendered paths", () => {
  const drawn = { lat: 0, lng: 0 };
  const live = destinationDegrees(drawn, 270, 1000);
  // Deliberately not 1000: an equal span either side of the snapshot puts the
  // segment's midpoint back exactly on it, so a label that never left the
  // snapshot would look correctly placed.
  const target = destinationDegrees(drawn, 90, 3000);
  const anchor = {
    type: "entity",
    entityId: "track-1",
    lastKnownPosition: drawn,
  } as const;
  const anchors = new Map([["track-1", live]]);

  it("remeasures a displayed range and moves its label when the anchor moves", () => {
    const result = buildPathLayerData(
      {
        id: "range-1",
        kind: "range",
        points: [anchor, { type: "coordinate", position: target }],
      },
      anchors,
      new Map(),
    );

    const midpoint = destinationDegrees(drawn, 90, 1000);

    expect(result.segments[0]?.groundDistanceM).toBeCloseTo(4000, 3);
    expect(result.segments[0]?.source).toEqual(live);
    expect(result.segments[0]?.position.lat).toBeCloseTo(midpoint.lat, 8);
    expect(result.segments[0]?.position.lng).toBeCloseTo(midpoint.lng, 8);
  });

  it("places the first range handle where its anchor is now", () => {
    const result = buildPathLayerData(
      {
        id: "range-placing",
        kind: "range",
        points: [anchor],
      },
      anchors,
      new Map(),
    );

    expect(result.vertices.map((vertex) => vertex.position)).toEqual([live]);
    expect(result.segments).toEqual([]);
  });
});

describe("freeform geometry from rendered paths", () => {
  const start = { lat: 0, lng: 0 };
  const oneKm = destinationDegrees(start, 90, 1000);
  const threeKm = destinationDegrees(start, 90, 3000);

  it("hands a displayed freeform every leg and puts its total at the last point", () => {
    const result = buildPathLayerData(
      {
        id: "freeform-1",
        kind: "freeform",
        points: [
          { type: "coordinate", position: start },
          { type: "coordinate", position: oneKm },
          { type: "coordinate", position: threeKm },
        ],
      },
      new Map(),
      new Map(),
    );

    expect(result.segments.map((segment) => Math.round(segment.groundDistanceM))).toEqual([
      1000, 2000,
    ]);
    expect(result.totals[0]?.position).toEqual(threeKm);
  });
});

describe("circle geometry from rendered paths", () => {
  const drawn = { lat: 0, lng: 0 };
  const live = { lat: 1, lng: 1 };
  const anchor = {
    type: "entity",
    entityId: "track-1",
    lastKnownPosition: drawn,
  } as const;
  const anchors = new Map([["track-1", live]]);

  it("draws a displayed circle around its moved anchor without changing its radius", () => {
    const result = buildPathLayerData(
      {
        id: "circle-1",
        kind: "circle",
        points: [anchor, { type: "coordinate", position: destinationDegrees(drawn, 90, 1000) }],
        radiusM: 1000,
      },
      anchors,
      new Map(),
    );
    const shape = drawingPreviewShape(
      "circle",
      result.vertices.map((vertex) => vertex.position),
    );
    const outer = shape?.type === "polygon" ? shape.outer : [];

    expect(outer).toHaveLength(64);
    for (const point of outer) expect(distanceM(live, point)).toBeCloseTo(1000, 3);
  });
});

describe("ring-set geometry from rendered paths", () => {
  it("omits handle bearings from ring-set labels before and after saving", () => {
    const placed: MapPath = {
      id: "ring-set",
      kind: "rb-circle",
      points: [
        { type: "coordinate", position: { lat: 70, lng: 21 } },
        {
          type: "coordinate",
          position: { lat: 70.03623075061162, lng: 21.078910817343363 },
        },
      ],
      rings: 3,
    };
    const entity = create(EntitySchema, {
      id: placed.id,
      controller: { id: CONTROLLER_ID },
      shape: writeDrawing(placed.kind, placed.points, placed.rings),
      metric: writeMetrics(placed.kind, placed.points, placed.rings),
    });
    const saved = readDrawing(entity);
    if (!saved) throw new Error("Expected a saved ring set");

    expect(saved.radiusM).toBeCloseTo(5040.043210000838, 6);
    expect(entity.metric?.metrics.map((metric) => metric.label)).toEqual([
      "Radius",
      "Rings",
      "Outer Radius",
    ]);

    for (const path of [{ id: placed.id, ...saved }, placed]) {
      const result = buildPathLayerData(path, new Map(), new Map());
      expect(result.segments[0]?.groundDistanceM).toBeCloseTo(5040.043210000838, 6);
      expect(result.segments[0]?.label).toBe("5.04 km GD");
      expect(result.totals.map((total) => total.label)).toEqual([
        "5.04 km GD",
        "10.08 km GD",
        "15.12 km GD",
      ]);
    }

    const range = buildPathLayerData(
      { ...placed, kind: "range", rings: undefined },
      new Map(),
      new Map(),
    );
    expect(range.segments[0]?.bearingDegrees).toBeCloseTo(36.64390499999864, 6);
    expect(range.segments[0]?.label).toBe("5.04 km GD · 037°T");
  });

  const drawn = { lat: 0, lng: 0 };
  const live = { lat: 1, lng: 1 };
  const anchor = {
    type: "entity",
    entityId: "track-1",
    lastKnownPosition: drawn,
  } as const;
  const anchors = new Map([["track-1", live]]);

  it("draws and labels a displayed ring set at multiples of its stored radius", () => {
    const result = buildPathLayerData(
      {
        id: "ring-set-1",
        kind: "rb-circle",
        points: [anchor, { type: "coordinate", position: destinationDegrees(drawn, 90, 1000) }],
        radiusM: 1000,
        rings: 3,
      },
      anchors,
      new Map(),
    );
    const shape = drawingPreviewShape(
      "rb-circle",
      result.vertices.map((vertex) => vertex.position),
      result.rings,
    );
    const geometries = shape?.type === "collection" ? shape.geometries : [];

    expect(geometries).toHaveLength(3);
    expect(result.totals).toHaveLength(3);
    expect(result.totals.map((total) => Math.round(distanceM(live, total.position)))).toEqual([
      1000, 2000, 3000,
    ]);
    expect(
      geometries.map((geometry) => {
        const point = geometry.type === "polygon" ? geometry.outer[0] : undefined;
        return point ? Math.round(distanceM(live, point)) : 0;
      }),
    ).toEqual([1000, 2000, 3000]);
  });
});

// The panel measures through metricSpecs and the map through buildPathLayerData.
// Two paths to the same quantity, so the panel and the map can disagree on it.
describe("buildPathLayerData, rectangle sides", () => {
  const first = { lat: 0, lng: 0 };
  const second = destinationDegrees(first, 90, 50_000);
  const skewed = destinationDegrees(second, 45, 50_000);

  const sides = () =>
    buildPathLayerData(
      {
        id: "rect-1",
        kind: "rectangle",
        points: [first, second, skewed].map((position) => ({
          type: "coordinate" as const,
          position,
        })),
      },
      new Map(),
      new Map(),
    ).segments;

  it("labels the sides the shape was built from, not the tap legs", () => {
    expect(sides().map((side) => Math.round(side.groundDistanceM))).toEqual([50_000, 35_355]);
  });

  it("agrees with the metrics the details panel publishes", () => {
    const published = Object.fromEntries(
      (
        writeMetrics(
          "rectangle",
          [first, second, skewed].map((position) => ({
            type: "coordinate" as const,
            position,
          })),
        )?.metrics ?? []
      ).map((metric) => [metric.label, metric.val.value as number]),
    );
    const [width, depth] = sides();

    expect(width!.groundDistanceM / 1000).toBeCloseTo(published["Width"]!, 6);
    expect(depth!.groundDistanceM / 1000).toBeCloseTo(published["Depth"]!, 6);
  });

  // The right length on the wrong side would still be wrong, so this asserts
  // placement as well as magnitude.
  it("puts each label on the side it measures", () => {
    const [width, depth] = sides();
    const corners = rectangleCorners(first, second, skewed);

    expect(width!.position).toEqual(geodesicMidpoint(corners[0], corners[1]));
    expect(depth!.position).toEqual(geodesicMidpoint(corners[1], corners[2]));
  });

  // On the equator facing due east the answers are 90 and 0, which a hardcoded
  // pair would also produce. A high-latitude diagonal cannot be faked, and the
  // fractional bearing rules out a whole-degree implementation too.
  it("runs each label along its own side", () => {
    const corner = { lat: 70, lng: 10 };
    const alongEdge = destinationDegrees(corner, 37.4, 50_000);
    const [width, depth] = buildPathLayerData(
      {
        id: "rect-2",
        kind: "rectangle",
        points: [corner, alongEdge, destinationDegrees(alongEdge, 82, 50_000)].map((position) => ({
          type: "coordinate" as const,
          position,
        })),
      },
      new Map(),
      new Map(),
    ).segments;

    expect(width!.bearingDegrees).toBeCloseTo(37.4, 3);
    expect(depth!.bearingDegrees).toBeCloseTo(
      finalBearing(
        { latitude: corner.lat, longitude: corner.lng },
        { latitude: alongEdge.lat, longitude: alongEdge.lng },
      ) + 90,
      3,
    );
  });
});
