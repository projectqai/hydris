import { Constants, Geodesic } from "geographiclib-geodesic";

const ECCENTRICITY_SQUARED = Constants.WGS84.f * (2 - Constants.WGS84.f);

export const MIN_CURVATURE_RADIUS_M = Constants.WGS84.a * (1 - Constants.WGS84.f) ** 2;

// Conservative lower bound on the WGS84 cut distance. Beyond a cut point,
// a direct geodesic is no longer shortest.
export const MAX_RING_RADIUS_M = Math.PI * Constants.WGS84.a * (1 - Constants.WGS84.f);

type GeoPoint = { latitude: number; longitude: number };
type GeoPointWithAltitude = GeoPoint & { altitude: number };

type Ecef = { x: number; y: number; z: number };

function toEcef(point: GeoPointWithAltitude): Ecef {
  const latitude = (point.latitude * Math.PI) / 180;
  const longitude = (point.longitude * Math.PI) / 180;
  const primeVertical =
    Constants.WGS84.a / Math.sqrt(1 - ECCENTRICITY_SQUARED * Math.sin(latitude) ** 2);
  return {
    x: (primeVertical + point.altitude) * Math.cos(latitude) * Math.cos(longitude),
    y: (primeVertical + point.altitude) * Math.sin(longitude) * Math.cos(latitude),
    z: (primeVertical * (1 - ECCENTRICITY_SQUARED) + point.altitude) * Math.sin(latitude),
  };
}

// built from geocentric positions, not the ground distance, which is an arc rather than a
// triangle edge. the angle is measured against the observer's own local horizontal.
export function slantRangeAndElevation(
  observer: GeoPointWithAltitude,
  target: GeoPointWithAltitude,
): { slantDistanceM: number; elevationAngleDegrees: number } {
  const from = toEcef(observer);
  const to = toEcef(target);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;

  const latitude = (observer.latitude * Math.PI) / 180;
  const longitude = (observer.longitude * Math.PI) / 180;
  const east = -Math.sin(longitude) * dx + Math.cos(longitude) * dy;
  const north =
    -Math.sin(latitude) * Math.cos(longitude) * dx -
    Math.sin(latitude) * Math.sin(longitude) * dy +
    Math.cos(latitude) * dz;
  const up =
    Math.cos(latitude) * Math.cos(longitude) * dx +
    Math.cos(latitude) * Math.sin(longitude) * dy +
    Math.sin(latitude) * dz;

  return {
    slantDistanceM: Math.sqrt(dx * dx + dy * dy + dz * dz),
    elevationAngleDegrees: (Math.atan2(up, Math.hypot(east, north)) * 180) / Math.PI,
  };
}

export function geodesicDistance(a: GeoPoint, b: GeoPoint): number {
  if (a.latitude === b.latitude && a.longitude === b.longitude) return 0;

  return Geodesic.WGS84.Inverse(a.latitude, a.longitude, b.latitude, b.longitude).s12 ?? 0;
}

export function initialBearing(a: GeoPoint, b: GeoPoint): number {
  const azimuth = Geodesic.WGS84.Inverse(a.latitude, a.longitude, b.latitude, b.longitude).azi1;
  return azimuth === undefined ? 0 : (azimuth + 360) % 360;
}

export function finalBearing(a: GeoPoint, b: GeoPoint): number {
  const azimuth = Geodesic.WGS84.Inverse(a.latitude, a.longitude, b.latitude, b.longitude).azi2;
  return azimuth === undefined ? 0 : (azimuth + 360) % 360;
}

export function ellipsoidPolygonArea(ring: readonly GeoPoint[]): number {
  if (ring.length < 3) return 0;

  const polygon = Geodesic.WGS84.Polygon(false);
  for (const point of ring) {
    polygon.AddPoint(point.latitude, point.longitude);
  }
  return Math.abs(polygon.Compute(false, true).area ?? 0);
}
