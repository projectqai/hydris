import { describe, expect, it } from "vitest";

import { densifyGeodesicPieces, densifyGeodesicRing, geodesicMidpoint } from "./geodesic-path";

const SF = { lat: 37.7749, lng: -122.4194 };
const NY = { lat: 40.7128, lng: -74.006 };

// the default sampled path is dense enough that interpolating between two points errs by under 0.01°.
function latAtLongitude(path: { lat: number; lng: number }[], lng: number): number {
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;
    if (from.lng <= lng && to.lng >= lng) {
      const t = (lng - from.lng) / (to.lng - from.lng);
      return from.lat + t * (to.lat - from.lat);
    }
  }
  throw new Error(`path does not cross ${lng}`);
}

function onlyPiece(source: { lat: number; lng: number }, target: { lat: number; lng: number }) {
  const pieces = densifyGeodesicPieces(source, target);
  expect(pieces).toHaveLength(1);
  return pieces[0]!;
}

describe("densifyGeodesicPieces", () => {
  it("leaves a short segment as its two endpoints", () => {
    const source = { lat: 70, lng: 13 };
    const target = { lat: 70.00003579332298, lng: 13.00007879949783 };
    expect(densifyGeodesicPieces(source, target, 22)).toEqual([[source, target]]);
  });

  it("preserves both bows across the equator when the midpoint fits the projected chord", () => {
    const pieces = densifyGeodesicPieces({ lat: -30, lng: 13 }, { lat: 32, lng: 86 }, -2);
    expect(pieces).toHaveLength(1);
    const path = pieces[0]!;

    // At zoom -2 the midpoint misses the chord by 0.127 px, below the 0.25 px budget.
    // WGS84 reference positions at 23% and 79% of the geodesic probe both bows.
    for (const reference of [
      { lat: -16.36467269150635, lng: 30.94740183859666 },
      { lat: 19.972549816295274, lng: 68.8791537203366 },
    ]) {
      expect(latAtLongitude(path, reference.lng)).toBeCloseTo(reference.lat, 0);
    }
  });

  it("bows north of both endpoints across the United States", () => {
    const maxLat = Math.max(...onlyPiece(SF, NY).map((point) => point.lat));

    // a rhumb line stays between the two latitudes. the geodesic reaches 42.08°.
    expect(maxLat).toBeGreaterThan(NY.lat);
    expect(maxLat).toBeCloseTo(42.08, 1);
  });
});

describe("antimeridian", () => {
  it("places an off-axis Arctic seam crossing on the reference geodesic", () => {
    const source = { lat: 73.2, lng: 178.4 };
    const target = { lat: 75.58399013471225, lng: -174.00518203166678 };
    for (const zoom of [undefined, 0, 8, 19]) {
      for (const { from, to } of [
        { from: source, to: target },
        { from: target, to: source },
      ]) {
        const viewport = { west: 36.99, east: 37.01, south: -12.01, north: -11.99 };
        const pieces = densifyGeodesicPieces(from, to, zoom, undefined, viewport);
        const crossings = pieces.flat().filter((point) => Math.abs(point.lng) === 180);
        expect(new Set(crossings.map((point) => point.lng))).toEqual(new Set([-180, 180]));
        for (const crossing of crossings) {
          expect(
            crossing.lat,
            "seam latitude lies on the WGS84 geodesic within 0.00000001 degrees",
          ).toBeCloseTo(73.78711933366866, 8);
        }
      }
    }
  });

  it("cuts a two-point crossing that is never densified", () => {
    const pieces = densifyGeodesicPieces(
      { lat: 0, lng: 179.99999 },
      { lat: 0, lng: -179.99999 },
      22,
    );

    expect(pieces).toEqual([
      [
        { lat: 0, lng: 179.99999 },
        { lat: 0, lng: 180 },
      ],
      [
        { lat: 0, lng: -180 },
        { lat: 0, lng: -179.99999 },
      ],
    ]);
  });
});

describe("geodesicMidpoint", () => {
  it("sits on the curve, not between the endpoints", () => {
    const midpoint = geodesicMidpoint(SF, NY);

    // the arithmetic mean of the endpoints is 39.24, -98.21, which is Kansas.
    expect(midpoint.lat).toBeCloseTo(41.86, 1);
    expect(midpoint.lng).toBeCloseTo(-98.75, 1);
    expect(midpoint.lat).toBeGreaterThan((SF.lat + NY.lat) / 2 + 2);
    // the course at the midpoint is 85.2°, not the 69.9° initial azimuth
    expect(midpoint.bearingDegrees).toBeCloseTo(85.2, 0);
  });

  it("reports a westward course in 0-360, not as a negative azimuth", () => {
    // heading roughly west, where geographiclib returns about -83 and the label flip that keeps
    // text upright would read it as upside down.
    const midpoint = geodesicMidpoint({ lat: 51.95, lng: 4.2 }, { lat: 51.96, lng: 4.16 });

    expect(midpoint.bearingDegrees).toBeGreaterThan(180);
    expect(midpoint.bearingDegrees).toBeLessThan(360);
  });
});

describe("densifyGeodesicPieces", () => {
  it("cuts a crossing path into two pieces that meet at the antimeridian", () => {
    const west = { lat: 78.5, lng: -164.9 };
    const east = { lat: 78.5, lng: 142.9 };
    const pieces = densifyGeodesicPieces(west, east);

    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.[0]).toEqual(west);
    expect(pieces[0]?.at(-1)?.lng).toBe(-180);
    expect(pieces[1]?.[0]?.lng).toBe(180);
    expect(pieces[1]?.at(-1)).toEqual(east);
  });
});

describe("antimeridian cut stays finite", () => {
  // deck.gl asserts on latitude, so one bad point takes down the whole layer
  it("keeps a step from 180 to -180 finite", () => {
    const pieces = densifyGeodesicPieces({ lat: 12, lng: 180 }, { lat: 12, lng: -180 });

    expect(pieces, "densified path returns at least one drawable piece").not.toHaveLength(0);

    for (const piece of pieces) {
      expect(
        piece.length,
        "drawable path piece contains at least two points",
      ).toBeGreaterThanOrEqual(2);
    }

    for (const point of pieces.flat()) {
      expect(Number.isFinite(point.lat)).toBe(true);
      expect(Math.abs(point.lat)).toBeLessThanOrEqual(90);
    }
  });

  it("keeps a ring built from longitudes several copies out in range", () => {
    const first = { lat: -60, lng: 700 };

    const pieces = densifyGeodesicRing([
      first,
      { lat: 10, lng: -540 },
      { lat: -80, lng: 190 },
      first,
    ]);

    expect(pieces, "densified ring returns at least one drawable piece").not.toHaveLength(0);

    for (const piece of pieces) {
      expect(
        piece.length,
        "drawable ring piece contains at least three points",
      ).toBeGreaterThanOrEqual(3);
    }

    for (const point of pieces.flat()) {
      expect(Math.abs(point.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(point.lng)).toBeLessThanOrEqual(180);
    }
  });
});

// Rings that cross the antimeridian more than once, where the last piece is merged
// back into the first. A hand-picked ring only ever proves the crossing it was
// drawn for, so these search instead.
describe("densifyGeodesicRing, rings crossing more than once", () => {
  function crossingRings(seed: number, trials: number) {
    let state = seed;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    return Array.from({ length: trials }, () => {
      const ring = Array.from({ length: 3 + Math.floor(random() * 6) }, () => ({
        lat: (random() - 0.5) * 140,
        // clustered on the antimeridian, in both world copies, so most rings cross
        lng: 180 - random() * 60 - (random() < 0.5 ? 0 : 300),
      }));
      return [...ring, ring[0]!];
    });
  }

  function renderablePieces(ring: { lat: number; lng: number }[]) {
    const pieces = densifyGeodesicRing(ring);
    expect(pieces, "densified ring returns at least one drawable piece").not.toHaveLength(0);
    for (const piece of pieces) {
      expect(
        piece.length,
        "drawable ring piece contains at least three points",
      ).toBeGreaterThanOrEqual(3);
      const first = piece[0]!;
      const last = piece.at(-1)!;
      if (pieces.length === 1) {
        expect(first, "uncut ring remains closed").toEqual(last);
      } else {
        expect(Math.abs(first.lng), "cut ring piece starts on the antimeridian").toBe(180);
        expect(first.lng, "cut ring piece starts and ends on the same meridian").toBe(last.lng);
      }
    }
    return pieces;
  }

  // A piece is drawn as given, so a step this wide strokes across the whole world
  // rather than the short way round.
  it("never leaves a step across the world inside a piece", () => {
    const offenders = crossingRings(20260830, 1000).flatMap((ring) =>
      renderablePieces(ring).flatMap((piece) =>
        piece.flatMap((point, i) =>
          i > 0 && Math.abs(point.lng - piece[i - 1]!.lng) > 180 ? [point.lng] : [],
        ),
      ),
    );

    expect(offenders.slice(0, 3)).toEqual([]);
  });
});
