import type { AngularVelocity, KinematicsEnu, OrientationComponent } from "@projectqai/proto/world";

export function formatDistance(
  meters: number,
  options?: {
    precision?: "standard" | "precise";
    unitStyle?: "compact" | "spaced";
  },
): string {
  const unitSeparator = options?.unitStyle === "spaced" ? " " : "";
  if (meters < 1000) return `${Math.round(meters)}${unitSeparator}m`;
  const kilometers = meters / 1000;
  const fractionDigits = options?.precision === "precise" ? 2 : 1;
  return `${kilometers.toFixed(fractionDigits)}${unitSeparator}km`;
}

// slant range and ground distance format identically, so the readout names which one it is
export function formatRangeReadout(groundDistanceM: number, slantDistanceM: number | null): string {
  const distance = formatDistance(slantDistanceM ?? groundDistanceM, {
    precision: "precise",
    unitStyle: "spaced",
  });
  return `${distance} ${slantDistanceM === null ? "GD" : "SR"}`;
}

export function formatArea(squareMeters: number): string {
  if (squareMeters < 100_000) {
    return `${Math.round(squareMeters).toLocaleString("en-US")} m²`;
  }
  const squareKilometers = squareMeters / 1_000_000;
  return `${squareKilometers.toFixed(2)} km²`;
}

export function roundBearing(degrees: number): number {
  return Math.round(degrees) % 360;
}

export function formatTrueBearing(degrees: number): string {
  return `${String(roundBearing(degrees)).padStart(3, "0")}°T`;
}

export function formatElevationAngle(degrees: number): string {
  const rounded = Math.round(degrees);
  const sign = rounded < 0 ? "-" : "+";
  return `${sign}${Math.abs(rounded)}°`;
}

export function calculateGroundSpeed(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu) return undefined;
  const east = velocityEnu.east ?? 0;
  const north = velocityEnu.north ?? 0;
  return Math.sqrt(east * east + north * north);
}

export function calculateHeadingFromOrientation(
  orientation?: OrientationComponent,
): number | undefined {
  const q = orientation?.orientation;
  if (!q) return undefined;
  // the x and y terms only vanish for a rotation about a single axis, so the shorter
  // 2 * atan2(z, w) skews once roll and pitch are both present
  const yawRad = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return ((yawRad * 180) / Math.PI + 360) % 360;
}

// zero horizontal velocity has no direction of travel, but atan2(0, 0) would report it as due north.
// a course of zero is valid for genuine due-north motion.
export function calculateCourseFromVelocity(velocityEnu?: KinematicsEnu): number | undefined {
  if (!velocityEnu) return undefined;
  const east = velocityEnu.east ?? 0;
  const north = velocityEnu.north ?? 0;
  if (east === 0 && north === 0) return undefined;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

export function calculateVerticalRate(velocityEnu?: Pick<KinematicsEnu, "up">): number | undefined {
  return velocityEnu?.up;
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
