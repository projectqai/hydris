const MAX_PAN_DEGREES = 10;
const DEAD_ZONE = 0.05;

export function nextAzimuth(currentAz: number, deltaFraction: number): number | null {
  if (!Number.isFinite(deltaFraction)) return null;
  const clamped = Math.max(-1, Math.min(1, deltaFraction));
  if (Math.abs(clamped) < DEAD_ZONE) return null;
  const delta = clamped * MAX_PAN_DEGREES;
  return (((currentAz + delta) % 360) + 360) % 360;
}
