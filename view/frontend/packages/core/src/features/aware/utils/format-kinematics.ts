import type { AngularVelocity, GeoSpatialComponent, KinematicsEnu } from "@projectqai/proto/world";

const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;

export function haversineDistance(
  a: Pick<GeoSpatialComponent, "latitude" | "longitude">,
  b: Pick<GeoSpatialComponent, "latitude" | "longitude">,
): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(a.latitude * DEG) * Math.cos(b.latitude * DEG) * sinLon * sinLon;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function calculateGroundSpeed(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu) return undefined;
  const east = velocityEnu.east ?? 0;
  const north = velocityEnu.north ?? 0;
  if (east === 0 && north === 0) return undefined;
  return Math.sqrt(east * east + north * north);
}

export function calculateCourseFromVelocity(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu) return undefined;
  const east = velocityEnu.east ?? 0;
  const north = velocityEnu.north ?? 0;
  if (east === 0 && north === 0) return undefined;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

export function calculateVerticalRate(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu?.up) return undefined;
  return velocityEnu.up;
}

export function formatSpeed(speedMs?: number): string {
  if (speedMs === undefined) return "—";
  return `${speedMs.toFixed(0)} m/s`;
}

export function formatCourse(degrees?: number): string {
  if (degrees === undefined) return "—";
  return `${degrees.toFixed(0)}°`;
}

export function formatVerticalRate(upMs?: number): string {
  if (upMs === undefined) return "—";
  const sign = upMs >= 0 ? "+" : "";
  return `${sign}${upMs.toFixed(1)} m/s`;
}

export function formatAcceleration(accelerationEnu?: KinematicsEnu): string {
  if (!accelerationEnu) return "—";
  const east = accelerationEnu.east ?? 0;
  const north = accelerationEnu.north ?? 0;
  const up = accelerationEnu.up ?? 0;
  const magnitude = Math.sqrt(east * east + north * north + up * up);
  if (magnitude === 0) return "—";
  return `${magnitude.toFixed(2)} m/s²`;
}

export function formatAngularRate(radPerSec: number): string {
  const degPerSec = (radPerSec * 180) / Math.PI;
  return `${degPerSec.toFixed(1)} °/s`;
}

export function hasAngularVelocity(av?: AngularVelocity): boolean {
  if (!av) return false;
  return av.rollRate !== 0 || av.pitchRate !== 0 || av.yawRate !== 0;
}
