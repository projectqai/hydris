import type { EditKind, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { describe, expect, it } from "vitest";

import { destinationDegrees } from "../utils/geodesic-circle";
import { geodesicDistance, initialBearing } from "../utils/geodesy";
import { derivePath, isCentreAndRadius, moveEditPoint, movePathPoint } from "./path-geometry";

const NO_ANCHORS: ReadonlyMap<string, GeoPosition> = new Map();

describe("movePathPoint", () => {
  // Stored vertices arrive as their own objects, so the closing vertex is built
  // separately here. Sharing one object would let closure be decided by
  // reference and never test the coordinates.
  //
  // Either end of the pair can be the one dragged, and dragging only the first
  // leaves the last index untested.
  it.each([0, 2])("moves both ends of a closed ring dragged at index %i", (index) => {
    const first = { type: "coordinate", position: { lat: 1, lng: 2 } } as const;
    const middle = { type: "coordinate", position: { lat: 3, lng: 4 } } as const;
    const closing = { type: "coordinate", position: { lat: 1, lng: 2 } } as const;
    const moved = { type: "coordinate", position: { lat: 5, lng: 6 } } as const;

    expect(movePathPoint([first, middle, closing], index, moved)).toEqual([moved, middle, moved]);
  });

  it("leaves an open path's other end alone", () => {
    const first = { type: "coordinate", position: { lat: 1, lng: 2 } } as const;
    const middle = { type: "coordinate", position: { lat: 3, lng: 4 } } as const;
    const last = { type: "coordinate", position: { lat: 5, lng: 6 } } as const;
    const moved = { type: "coordinate", position: { lat: 7, lng: 8 } } as const;

    expect(movePathPoint([first, middle, last], 0, moved)).toEqual([moved, middle, last]);
  });
});

describe("moveEditPoint", () => {
  // An edge due east of an equatorial centre reads the same as a bearing that
  // was hardcoded, so this one sits off-axis and away from the equator. The
  // fraction matters too: a whole-degree bearing survives being rounded.
  const EDGE_BEARING = 214.37;
  const CENTRE = { type: "coordinate", position: { lat: 48, lng: 11 } } as const;
  const EDGE = {
    type: "coordinate",
    position: destinationDegrees(CENTRE.position, EDGE_BEARING, 1000),
  } as const;
  const MOVED = { type: "coordinate", position: { lat: 52, lng: -1 } } as const;

  const radiusOf = (points: readonly PathPoint[]) => {
    const [a, b] = points;
    if (a?.type !== "coordinate" || b?.type !== "coordinate") return 0;
    return geodesicDistance(
      { latitude: a.position.lat, longitude: a.position.lng },
      { latitude: b.position.lat, longitude: b.position.lng },
    );
  };

  const bearingOf = (points: readonly PathPoint[]) => {
    const [a, b] = points;
    if (a?.type !== "coordinate" || b?.type !== "coordinate") return 0;
    return initialBearing(
      { latitude: a.position.lat, longitude: a.position.lng },
      { latitude: b.position.lat, longitude: b.position.lng },
    );
  };

  it("carries a circle's edge handle along with its centre, keeping the radius", () => {
    const moved = moveEditPoint([CENTRE, EDGE], 0, MOVED, "circle");

    expect(moved[0]).toEqual(MOVED);
    expect(moved[1]).not.toEqual(EDGE);
    expect(radiusOf(moved)).toBeCloseTo(radiusOf([CENTRE, EDGE]), 3);
    expect(bearingOf(moved)).toBeCloseTo(EDGE_BEARING, 6);
  });

  it("carries a ring set's edge handle the same way", () => {
    const moved = moveEditPoint([CENTRE, EDGE], 0, MOVED, "rb-circle");

    expect(moved[0]).toEqual(MOVED);
    expect(radiusOf(moved)).toBeCloseTo(radiusOf([CENTRE, EDGE]), 3);
    expect(bearingOf(moved)).toBeCloseTo(EDGE_BEARING, 6);
  });

  it("changes only the radius when a circle's edge moves", () => {
    const moved = moveEditPoint(
      [CENTRE, EDGE],
      1,
      { type: "coordinate", position: destinationDegrees(CENTRE.position, EDGE_BEARING, 2000) },
      "circle",
    );

    expect(moved[0]).toEqual(CENTRE);
    expect(radiusOf(moved)).toBeGreaterThan(radiusOf([CENTRE, EDGE]));
  });

  it("leaves the other end alone for any other kind", () => {
    expect(moveEditPoint([CENTRE, EDGE], 0, MOVED, "range")).toEqual([MOVED, EDGE]);
    expect(moveEditPoint([CENTRE, EDGE], 0, MOVED, null)).toEqual([MOVED, EDGE]);
  });
});

describe("derivePath", () => {
  it("withholds area when geodesic edges cross but latitude-longitude chords do not", () => {
    // Independent direct solutions put edges 0 and 2 through 75°N, 23°E at
    // bearings 37° and 104°. Neither pair of non-adjacent lat/lng chords crosses.
    const derived = derivePath(
      [
        { type: "coordinate", position: { lat: 77.1544502746639, lng: 123.20315470573671 } },
        { type: "coordinate", position: { lat: 72.92251667074078, lng: 17.83517258909755 } },
        { type: "coordinate", position: { lat: 62.97987809193758, lng: 67.92705132949446 } },
        { type: "coordinate", position: { lat: 71.64244303801527, lng: -30.034146239567306 } },
        { type: "coordinate", position: { lat: 77.1544502746639, lng: 123.20315470573671 } },
      ],
      NO_ANCHORS,
    );

    expect(derived.areaM2).toBeNull();
    expect(derived.positions).toHaveLength(5);
    expect(derived.segments[0]?.groundDistanceM).toBeCloseTo(2_662_063.418864291, 3);
    expect(derived.segments[2]?.groundDistanceM).toBeCloseTo(3_833_451.2120453906, 3);
  });

  // Equal legs make "first leg times leg count" indistinguishable from a sum, so
  // the legs differ and the total cannot be reached any other way.
  it("reports the running ground total", () => {
    const derived = derivePath(
      [
        { type: "coordinate", position: { lat: 0, lng: 0 } },
        { type: "coordinate", position: { lat: 1, lng: 0 } },
        { type: "coordinate", position: { lat: 1, lng: 3 } },
      ],
      NO_ANCHORS,
    );

    const [first, second] = derived.segments;
    expect(first!.groundDistanceM).not.toBeCloseTo(second!.groundDistanceM, -3);
    expect(derived.totalGroundDistanceM!).toBeCloseTo(
      first!.groundDistanceM + second!.groundDistanceM,
      6,
    );
  });

  // Omitting only the target's altitude passes even if the source is never
  // checked, so each end has to be the missing one in turn.
  it.each([
    ["source", { lat: 0, lng: 0 }, { lat: 1, lng: 0, alt: 100 }],
    ["target", { lat: 0, lng: 0, alt: 100 }, { lat: 1, lng: 0 }],
  ])("reports slant range unavailable when the %s lacks altitude", (_end, from, to) => {
    const derived = derivePath(
      [
        { type: "coordinate", position: from },
        { type: "coordinate", position: to },
      ],
      NO_ANCHORS,
    );

    expect(derived.segments[0]?.slantDistanceM).toBeNull();
  });

  it("uses altitude difference for slant range", () => {
    const groundDistanceM = 110_574.39;
    // A 0.75 altitude leg and a 1.0 ground leg form a 3-4-5 triangle.
    const altitudeDifferenceM = groundDistanceM * 0.75;
    const derived = derivePath(
      [
        { type: "coordinate", position: { lat: 0, lng: 0, alt: 10_000 } },
        {
          type: "coordinate",
          position: { lat: 1, lng: 0, alt: 10_000 + altitudeDifferenceM },
        },
      ],
      NO_ANCHORS,
    );

    // independent geocentric value. a flat triangle would give 138 218 m.
    expect(derived.segments[0]?.slantDistanceM).toBeCloseTo(138_934.604, 2);
  });

  it("reports positive elevation toward a higher endpoint", () => {
    const groundDistanceM = 110_574.39;
    const altitudeDifferenceM = groundDistanceM * 0.75;
    const derived = derivePath(
      [
        { type: "coordinate", position: { lat: 0, lng: 0, alt: 0 } },
        { type: "coordinate", position: { lat: 1, lng: 0, alt: altitudeDifferenceM } },
      ],
      NO_ANCHORS,
    );

    // the flat 3-4-5 answer is 36.87°, before the earth drops away over a 110 km leg.
    expect(derived.segments[0]?.elevationAngleDegrees).toBeCloseTo(36.18995, 4);
  });

  // The depression angle is the same at any equal altitude, because the chord's
  // direction follows the central angle and not the radius. So the angle alone
  // cannot tell whether the altitudes were read at all. The chord's length can.
  it("reports endpoints at the same altitude as below the horizon", () => {
    const atAltitude = (alt: number) =>
      derivePath(
        [
          { type: "coordinate", position: { lat: 0, lng: 0, alt } },
          { type: "coordinate", position: { lat: 1, lng: 0, alt } },
        ],
        NO_ANCHORS,
      ).segments[0];

    const seaLevel = atAltitude(0);
    const high = atAltitude(100_000);

    // equal altitude is not level: the surface curves 0.5° away over 110 km,
    // at whatever height the pair sits.
    expect(seaLevel?.elevationAngleDegrees).toBeCloseTo(-0.5, 4);
    expect(high?.elevationAngleDegrees).toBeCloseTo(-0.5, 4);
    // same central angle on a wider arc, so the chord grows by (R+h)/R
    expect(high!.slantDistanceM! / seaLevel!.slantDistanceM!).toBeCloseTo(1 + 100 / 6371, 3);
  });

  // One segment cannot tell a running sum from an assignment, so this walks two
  // legs and the total has to exceed either of them.
  it("reports the running slant total", () => {
    const derived = derivePath(
      [
        { type: "coordinate", position: { lat: 0, lng: 0, alt: 0 } },
        { type: "coordinate", position: { lat: 1, lng: 0, alt: 80_000 } },
        { type: "coordinate", position: { lat: 1, lng: 3, alt: 20_000 } },
      ],
      NO_ANCHORS,
    );

    const [first, second] = derived.segments;
    expect(derived.totalSlantDistanceM!).toBeCloseTo(
      first!.slantDistanceM! + second!.slantDistanceM!,
      6,
    );
    expect(derived.totalSlantDistanceM!).toBeGreaterThan(second!.slantDistanceM!);
  });

  // Put the gap last and a per-segment assignment reads the same as a flag that
  // sticks, because nothing measurable follows it. Each position in turn.
  it.each([
    [
      "first",
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0, alt: 0 },
        { lat: 2, lng: 0, alt: 0 },
      ],
    ],
    [
      "last",
      [
        { lat: 0, lng: 0, alt: 0 },
        { lat: 1, lng: 0, alt: 0 },
        { lat: 2, lng: 0 },
      ],
    ],
  ])("reports the slant total unavailable when the %s segment lacks altitude", (_which, path) => {
    const derived = derivePath(
      path.map((position) => ({ type: "coordinate", position })),
      NO_ANCHORS,
    );

    // the other segment does measure, so the total is being withheld rather than
    // never computed
    expect(derived.segments.filter((segment) => segment?.slantDistanceM !== null)).toHaveLength(1);
    expect(derived.totalGroundDistanceM).toBeCloseTo(221_149.45, 0);
    expect(derived.totalSlantDistanceM).toBeNull();
  });

  it("exposes an entity vertex whose anchor is missing", () => {
    const derived = derivePath(
      [
        { type: "coordinate", position: { lat: 0, lng: 0 } },
        { type: "entity", entityId: "lost-track" },
        { type: "coordinate", position: { lat: 2, lng: 0 } },
      ],
      NO_ANCHORS,
    );

    expect(derived).toEqual({
      positions: [{ lat: 0, lng: 0 }, null, { lat: 2, lng: 0 }],
      segments: [null, null],
      totalGroundDistanceM: null,
      totalSlantDistanceM: null,
      areaM2: null,
      unresolvedEntityIds: ["lost-track"],
    });
  });

  // A segment count of two is also what two nulls give, so each leg has to carry
  // the length and bearing it was built with.
  it("measures through an unresolved entity at its last known position", () => {
    const start = { lat: 48, lng: 11 };
    const lastKnown = destinationDegrees(start, 63.42, 40_000);
    const end = destinationDegrees(lastKnown, 128.73, 25_000);
    const derived = derivePath(
      [
        { type: "coordinate", position: start },
        { type: "entity", entityId: "lost-track", lastKnownPosition: lastKnown },
        { type: "coordinate", position: end },
      ],
      NO_ANCHORS,
    );

    expect(derived.positions).toEqual([start, lastKnown, end]);
    expect(derived.segments[0]?.groundDistanceM).toBeCloseTo(40_000, 3);
    expect(derived.segments[0]?.bearingDegrees).toBeCloseTo(63.42, 6);
    expect(derived.segments[1]?.groundDistanceM).toBeCloseTo(25_000, 3);
    expect(derived.segments[1]?.bearingDegrees).toBeCloseTo(128.73, 6);
    expect(derived.unresolvedEntityIds).toEqual(["lost-track"]);
  });

  it("prefers an entity's current position to its last known position", () => {
    const derived = derivePath(
      [
        {
          type: "entity",
          entityId: "track-1",
          lastKnownPosition: { lat: 1, lng: 2 },
        },
      ],
      new Map([["track-1", { lat: 3, lng: 4 }]]),
    );

    expect(derived.positions).toEqual([{ lat: 3, lng: 4 }]);
    expect(derived.unresolvedEntityIds).toEqual([]);
  });
});

describe("derivePath, anchored centre", () => {
  const DRAWN = { lat: 48, lng: 11 };
  const EDGE_BEARING = 214.37;
  const MOVED_TO = { lat: 52, lng: -1 };
  const ANCHORED = {
    type: "entity",
    entityId: "track-1",
    lastKnownPosition: DRAWN,
  } as const;

  function segmentAfterMovingTo(target: { lat: number; lng: number }, kind: EditKind) {
    const edge = destinationDegrees(DRAWN, EDGE_BEARING, 1000);
    const derived = derivePath(
      [ANCHORED, { type: "coordinate", position: edge }],
      new Map([["track-1", target]]),
      kind,
      isCentreAndRadius(kind) ? 1000 : undefined,
    );
    return derived.segments[0];
  }

  it.each(["circle", "rb-circle"] as const)(
    "carries a %s's edge around its moved centre, keeping radius and bearing",
    (kind) => {
      const segment = segmentAfterMovingTo(MOVED_TO, kind);

      expect(segment?.groundDistanceM).toBeCloseTo(1000, 3);
      expect(segment?.bearingDegrees).toBeCloseTo(EDGE_BEARING, 6);
    },
  );

  it("still measures a range to wherever its anchor went", () => {
    expect(segmentAfterMovingTo(MOVED_TO, "range")?.groundDistanceM).toBeGreaterThan(100_000);
  });
});
