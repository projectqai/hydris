import type { GeoPosition, ShapeGeometry } from "../types";

const EARTH_RADIUS = 6_371_008.8; // mean Earth radius in meters (WGS-84)

function destination(origin: GeoPosition, bearingRad: number, distanceM: number): GeoPosition {
  const angularDist = distanceM / EARTH_RADIUS;
  const latRad = (origin.lat * Math.PI) / 180;
  const lngRad = (origin.lng * Math.PI) / 180;

  const sinAng = Math.sin(angularDist);
  const cosAng = Math.cos(angularDist);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  const destLat = Math.asin(sinLat * cosAng + cosLat * sinAng * Math.cos(bearingRad));
  const destLng =
    lngRad +
    Math.atan2(Math.sin(bearingRad) * sinAng * cosLat, cosAng - sinLat * Math.sin(destLat));

  return {
    lat: (destLat * 180) / Math.PI,
    lng: (destLng * 180) / Math.PI,
  };
}

function buildRing(center: GeoPosition, radiusM: number, segments: number): GeoPosition[] {
  const step = (2 * Math.PI) / segments;
  const ring: GeoPosition[] = [];
  for (let i = 0; i < segments; i++) {
    ring.push(destination(center, i * step, radiusM));
  }
  return ring;
}

export function circleToPolygon(
  center: GeoPosition,
  radiusM: number,
  innerRadiusM?: number,
  segments = 64,
): Extract<ShapeGeometry, { type: "polygon" }> {
  const outer = buildRing(center, radiusM, segments);
  const holes = innerRadiusM ? [buildRing(center, innerRadiusM, segments)] : undefined;
  return { type: "polygon", outer, holes };
}
