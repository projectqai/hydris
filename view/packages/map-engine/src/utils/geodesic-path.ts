import { Geodesic } from "geographiclib-geodesic";

import type { GeoPosition } from "../types";
import { MIN_CURVATURE_RADIUS_M } from "./geodesy";

const GEODESIC_STEP_M = 100_000;
const GEODESIC_MAX_POINTS = 256;
const GEODESIC_ERROR_PX = 0.25;

export type GeodesicViewport = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type GeodesicSample = {
  parameter: number;
  position: GeoPosition;
  x: number;
  y: number;
};

type SampledGeodesic = {
  key: string;
  samples: GeodesicSample[] | null;
  viewport?: GeodesicViewport;
};

type GeodesicTrim = {
  source: GeoPosition;
  target: GeoPosition;
  startM: number;
  endM: number;
};

// Retain only the current subdivision for each live endpoint pair.
const sampledGeodesics = new WeakMap<GeoPosition, WeakMap<GeoPosition, SampledGeodesic>>();

function curveOutsideViewport(
  middle: GeoPosition,
  radiusM: number,
  viewport: GeodesicViewport,
): boolean {
  // Arc length bounds latitude through the ellipsoid's smallest curvature radius.
  // Bounding longitude needs the smallest cosine anywhere in that latitude interval.
  const latitudeRadius = (radiusM / MIN_CURVATURE_RADIUS_M) * (180 / Math.PI);
  const latitudeLimit = Math.abs(middle.lat) + latitudeRadius;
  if (latitudeLimit >= 90) return false;
  const longitudeRadius = latitudeRadius / Math.cos((latitudeLimit * Math.PI) / 180);
  const west = middle.lng - longitudeRadius;
  const east = middle.lng + longitudeRadius;
  // Keep resolving seam crossings even off screen: polygon closure depends on them.
  if (Math.floor((west + 180) / 360) !== Math.floor((east + 180) / 360)) return false;
  if (middle.lat + latitudeRadius < viewport.south || middle.lat - latitudeRadius > viewport.north)
    return true;
  const world = 360 * Math.round(((viewport.west + viewport.east) / 2 - middle.lng) / 360);
  return east + world < viewport.west || west + world > viewport.east;
}

export function sampleProjectedCurve(
  start: number,
  end: number,
  positionAt: (parameter: number) => GeoPosition | null,
  zoom: number,
  viewport?: GeodesicViewport,
  metersPerParameter = Infinity,
): GeodesicSample[] | null {
  const tolerance = GEODESIC_ERROR_PX / (512 * 2 ** Math.ceil(zoom));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  )
    return null;
  const evaluated = new Map<number, GeodesicSample>();
  const at = (parameter: number): GeodesicSample | null => {
    const existing = evaluated.get(parameter);
    if (existing) return existing;
    const position = positionAt(parameter);
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
    // Match the renderer's latitude clamp, including curves beyond the camera's latitude limits.
    const latitude = Math.max(-89.9, Math.min(89.9, position.lat));
    const sample = {
      parameter,
      position,
      x: position.lng / 360,
      y: Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / (2 * Math.PI),
    };
    evaluated.set(parameter, sample);
    return sample;
  };
  const first = at(start);
  const last = at(end);
  if (!first || !last) return null;
  const samples: GeodesicSample[] = [first];
  const subdivide = (from: GeodesicSample, to: GeodesicSample): boolean => {
    const span = to.parameter - from.parameter;
    const middle = at(from.parameter + span / 2);
    if (!middle) return false;
    if (
      viewport &&
      curveOutsideViewport(middle.position, (Math.abs(span) * metersPerParameter) / 2, viewport)
    ) {
      samples.push(to);
      return true;
    }
    const quarter = at(from.parameter + span / 4);
    const threeQuarter = at(from.parameter + (3 * span) / 4);
    if (!quarter || !threeQuarter) return false;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    // A geodesic crossing the equator can have its midpoint on the chord while both halves bow.
    const error = Math.max(
      ...[quarter, middle, threeQuarter].map((point) => {
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(
                0,
                Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
              );
        return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
      }),
    );
    if (error <= tolerance) {
      samples.push(to);
      return true;
    }
    if (middle.parameter === from.parameter || middle.parameter === to.parameter) return false;
    return subdivide(from, middle) && subdivide(middle, to);
  };
  return subdivide(first, last) ? samples : null;
}

function sampleGeodesic(
  source: GeoPosition,
  target: GeoPosition,
  zoom: number,
  viewport?: GeodesicViewport,
) {
  const key = `${source.lat}:${source.lng}:${target.lat}:${target.lng}:${Math.ceil(zoom)}`;
  const targets = sampledGeodesics.get(source) ?? new WeakMap<GeoPosition, SampledGeodesic>();
  const cached = targets.get(target);
  if (cached?.key === key && cached.viewport === viewport) return cached.samples;
  const line = Geodesic.WGS84.InverseLine(source.lat, source.lng, target.lat, target.lng);
  const samples = sampleProjectedCurve(
    0,
    line.s13,
    (distanceM) => positionAt(line, distanceM, true),
    zoom,
    viewport,
    1,
  );
  if (!samples)
    console.warn("Geodesic sampling could not meet the projected error budget; using endpoints.");
  targets.set(target, { key, samples, viewport });
  sampledGeodesics.set(source, targets);
  return samples;
}

export function densifyGeodesicPath(
  source: GeoPosition,
  target: GeoPosition,
  zoom?: number,
  trim?: GeodesicTrim,
  viewport?: GeodesicViewport,
): GeoPosition[] {
  if (zoom !== undefined) {
    const samples = sampleGeodesic(source, target, zoom, viewport);
    if (!samples) return [trim?.source ?? source, trim?.target ?? target];
    const startM = trim?.startM ?? 0;
    const endM = trim?.endM ?? Infinity;
    return [
      trim?.source ?? source,
      ...samples
        .slice(1, -1)
        .filter((sample) => sample.parameter > startM && sample.parameter < endM)
        .map((sample) => sample.position),
      trim?.target ?? target,
    ];
  }
  const line = Geodesic.WGS84.InverseLine(source.lat, source.lng, target.lat, target.lng);
  const totalM = line.s13 ?? 0;
  if (!Number.isFinite(totalM) || totalM <= GEODESIC_STEP_M) return [source, target];

  const steps = Math.min(Math.ceil(totalM / GEODESIC_STEP_M), GEODESIC_MAX_POINTS - 1);
  const path: GeoPosition[] = [source];
  for (let i = 1; i < steps; i++) {
    const point = positionAt(line, (totalM * i) / steps);
    if (point) path.push(point);
  }
  path.push(target);
  return path;
}

// one path per world copy the geodesic passes through
export function densifyGeodesicPieces(
  source: GeoPosition,
  target: GeoPosition,
  zoom?: number,
  trim?: GeodesicTrim,
  viewport?: GeodesicViewport,
): GeoPosition[][] {
  return splitAtAntimeridian(densifyGeodesicPath(source, target, zoom, trim, viewport));
}

// each piece starts and ends on the same meridian, so closing the polygon draws the missing edge
export function densifyGeodesicRing(
  ring: readonly GeoPosition[],
  zoom?: number,
  viewport?: GeodesicViewport,
): GeoPosition[][] {
  if (ring.length < 3) return [];
  const densified: GeoPosition[] = [];
  for (let i = 1; i < ring.length; i++) {
    const source = ring[i - 1];
    const target = ring[i];
    if (source && target) {
      for (const point of densifyGeodesicPath(source, target, zoom, undefined, viewport).slice(
        0,
        -1,
      ))
        densified.push(point);
    }
  }
  const closing = ring.at(-1);
  if (closing) densified.push(closing);

  return splitRingAtAntimeridian(densified);
}

export function splitRingAtAntimeridian(
  ring: readonly GeoPosition[],
  pole?: "north" | "south",
): GeoPosition[][] {
  const pieces = splitAtAntimeridian(ring);
  if (pieces.length < 2) return pieces;
  // the ring's start sits inside a piece, so the last piece runs on into the first
  const last = pieces.pop();
  const first = pieces.shift();
  if (!last || !first) return pieces;
  const joined = [...last, ...first.slice(1)];
  const start = joined[0];
  const end = joined.at(-1);
  if (pole && start && end && Math.abs(start.lng - end.lng) > 180) {
    const lat = pole === "north" ? 90 : -90;
    joined.push({ lat, lng: end.lng }, { lat, lng: 0 }, { lat, lng: start.lng }, start);
  }
  return [joined, ...pieces];
}

// unprojecting a click returns the longitude of the world copy it landed in, so a vertex can
// arrive at 260. seam detection compares longitudes inside ±180.
// the in-range shortcut is not an optimisation: folding a value that already fits shifts its last
// bits, and callers compare the endpoints they passed in against the ones they get back.
export function wrapLongitude(lng: number): number {
  if (lng >= -180 && lng <= 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function crossingAtAntimeridian(
  source: GeoPosition,
  target: GeoPosition,
  positionAtFraction: (fraction: number) => GeoPosition | null,
): GeoPosition | null {
  const from = wrapLongitude(source.lng);
  const to = wrapLongitude(target.lng);
  const delta = to - from;
  if (Math.abs(delta) <= 180) return null;
  const eastward = delta < 0;
  const exit = eastward ? 180 : -180;
  let lat = from === exit ? source.lat : target.lat;
  if (from !== exit && to !== -exit) {
    let start = 0;
    let end = 1;
    // The callback keeps longitude unrolled in the source's world copy.
    for (let i = 0; i < 48; i++) {
      const middle = (start + end) / 2;
      const crossing = positionAtFraction(middle);
      if (!crossing || !Number.isFinite(crossing.lat) || !Number.isFinite(crossing.lng)) break;
      lat = crossing.lat;
      if (crossing.lng < exit === eastward) start = middle;
      else end = middle;
    }
  }
  return { lat, lng: exit };
}

export function splitAtAntimeridian(path: readonly GeoPosition[]): GeoPosition[][] {
  const pieces: GeoPosition[][] = [];
  let current: GeoPosition[] = [];
  let previous: GeoPosition | undefined;
  for (const source of path) {
    const lng = wrapLongitude(source.lng);
    const point = lng === source.lng ? source : { ...source, lng };
    const delta = previous ? point.lng - previous.lng : 0;
    if (previous && Math.abs(delta) > 180) {
      const line = Geodesic.WGS84.InverseLine(previous.lat, previous.lng, point.lat, point.lng);
      const crossing = crossingAtAntimeridian(previous, point, (fraction) =>
        positionAt(line, line.s13 * fraction, true),
      );
      if (crossing) {
        current.push(crossing);
        pieces.push(current);
        current = [{ lat: crossing.lat, lng: -crossing.lng }];
      }
    }
    current.push(point);
    previous = point;
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

export type GeodesicMidpoint = GeoPosition & { bearingDegrees: number };

export function geodesicMidpoint(source: GeoPosition, target: GeoPosition): GeodesicMidpoint {
  const line = Geodesic.WGS84.InverseLine(source.lat, source.lng, target.lat, target.lng);
  const totalM = line.s13 ?? 0;
  const fallback = { ...source, bearingDegrees: normalizeBearing(line.azi1) };
  if (!Number.isFinite(totalM) || totalM === 0) return fallback;

  const { lat2, lon2, azi2 } = line.Position(totalM / 2);
  if (lat2 === undefined || lon2 === undefined) return fallback;
  return { lat: lat2, lng: lon2, bearingDegrees: normalizeBearing(azi2 ?? line.azi1) };
}

// geographiclib returns azimuths in ±180 while every bearing elsewhere is 0-360, and the label
// flip that keeps text upright reads the wrong side of the range otherwise
function normalizeBearing(azimuth: number | undefined): number {
  return azimuth === undefined ? 0 : (azimuth + 360) % 360;
}

type GeodesicLine = ReturnType<typeof Geodesic.WGS84.InverseLine>;

function positionAt(line: GeodesicLine, distanceM: number, unroll = false): GeoPosition | null {
  const { lat2, lon2 } = line.Position(
    distanceM,
    Geodesic.STANDARD | (unroll ? Geodesic.LONG_UNROLL : 0),
  );
  return lat2 === undefined || lon2 === undefined ? null : { lat: lat2, lng: lon2 };
}
