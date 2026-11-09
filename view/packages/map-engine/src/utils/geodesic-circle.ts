import { Constants, Geodesic } from "geographiclib-geodesic";

import type { GeoPosition, ShapeGeometry } from "../types";
import {
  crossingAtAntimeridian,
  type GeodesicViewport,
  sampleProjectedCurve,
  wrapLongitude,
} from "./geodesic-path";
import { geodesicDistance, MAX_RING_RADIUS_M, MIN_CURVATURE_RADIUS_M } from "./geodesy";

export function destination(
  origin: GeoPosition,
  bearingRad: number,
  distanceM: number,
): GeoPosition {
  const { lat2, lon2 } = Geodesic.WGS84.Direct(
    origin.lat,
    origin.lng,
    (bearingRad * 180) / Math.PI,
    distanceM,
  );
  return lat2 === undefined || lon2 === undefined ? origin : { lat: lat2, lng: lon2 };
}

export function destinationDegrees(
  origin: GeoPosition,
  bearingDeg: number,
  distanceM: number,
): GeoPosition {
  return destination(origin, (bearingDeg * Math.PI) / 180, distanceM);
}

function buildRing(
  center: GeoPosition,
  radiusM: number,
  segments: number,
  zoom?: number,
  viewport?: GeodesicViewport,
): GeoPosition[] {
  const samples: { parameter: number; position: GeoPosition }[] = [];
  if (zoom !== undefined) {
    // Near an antipode, r grossly overbounds the rim's speed. Compare the Jacobi
    // field with a sphere, bounding its curvature remainder by |m(s)| <= R sinh(s/R).
    const a = Constants.WGS84.a;
    const preCutSeparationBoundM = radiusM <= MAX_RING_RADIUS_M ? radiusM : Infinity;
    const sphereJacobiMagnitudeM = a * Math.abs(Math.sin(radiusM / a));
    const R = MIN_CURVATURE_RADIUS_M;
    const curvatureRemainderBoundM = a * (1 - (R / a) ** 2) * (Math.cosh(radiusM / R) - 1);
    const radialSeparationM = Math.min(
      preCutSeparationBoundM,
      sphereJacobiMagnitudeM + curvatureRemainderBoundM,
    );
    for (let start = 0; start < 360; start += 90) {
      const from = destinationDegrees(center, start, radiusM);
      const arc = sampleProjectedCurve(
        start,
        start + 90,
        (bearing) => {
          const position = destinationDegrees(center, bearing, radiusM);
          return { ...position, lng: from.lng + wrapLongitude(position.lng - from.lng) };
        },
        zoom,
        viewport,
        (radialSeparationM * Math.PI) / 180,
      );
      if (!arc) {
        console.warn(
          "Circle sampling could not meet the projected error budget; using fixed segments.",
        );
        return buildRing(center, radiusM, segments);
      }
      for (const sample of arc.slice(0, -1)) samples.push(sample);
    }
  } else {
    const step = (2 * Math.PI) / segments;
    for (let i = 0; i < segments; i++) {
      samples.push({
        parameter: (i * step * 180) / Math.PI,
        position: destination(center, i * step, radiusM),
      });
    }
  }
  const first = samples[0];
  if (first) samples.push({ parameter: 360, position: first.position });
  const ring: GeoPosition[] = [];
  for (const [index, sample] of samples.entries()) {
    const next = samples[index + 1];
    if (!next) break;
    ring.push(sample.position);
    const crossing = crossingAtAntimeridian(sample.position, next.position, (fraction) => {
      const bearing = sample.parameter + (next.parameter - sample.parameter) * fraction;
      const position = destinationDegrees(center, bearing, radiusM);
      const lng = wrapLongitude(sample.position.lng);
      return { ...position, lng: lng + wrapLongitude(position.lng - lng) };
    });
    if (crossing) ring.push(crossing);
  }
  return ring;
}

export function circleToPolygon(
  center: GeoPosition,
  radiusM: number,
  innerRadiusM?: number,
  segments = 64,
  zoom?: number,
  viewport?: GeodesicViewport,
): Extract<ShapeGeometry, { type: "polygon" }> {
  const outer = buildRing(center, radiusM, segments, zoom, viewport);
  const holes = innerRadiusM
    ? [buildRing(center, innerRadiusM, segments, zoom, viewport)]
    : undefined;
  const origin = { latitude: center.lat, longitude: center.lng };
  const north = radiusM > geodesicDistance(origin, { latitude: 90, longitude: center.lng });
  const south = radiusM > geodesicDistance(origin, { latitude: -90, longitude: center.lng });
  return {
    type: "polygon",
    outer,
    holes,
    enclosedPoles: north && south ? "both" : north ? "north" : south ? "south" : undefined,
  };
}
