import type { GeoPosition } from "../types";
import { destinationDegrees } from "../utils/geodesic-circle";
import { geodesicDistance, MAX_RING_RADIUS_M } from "../utils/geodesy";

// Clamp the spacing, not individual rings, to retain one scale with distinct rings.
export function ringRadii(radiusM: number, count: number): number[] {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || !Number.isInteger(count) || count <= 0)
    return [];
  const spacingM = Math.min(radiusM, MAX_RING_RADIUS_M / count);
  return Array.from({ length: count }, (_, index) =>
    Math.min(MAX_RING_RADIUS_M, spacingM * (index + 1)),
  );
}

export function ringRadius(centre: GeoPosition, edge: GeoPosition): number {
  return geodesicDistance(
    { latitude: centre.lat, longitude: centre.lng },
    { latitude: edge.lat, longitude: edge.lng },
  );
}

// Each ring is labelled where it crosses due south of the centre, which keeps
// the labels stacked under one another instead of scattered around the rims.
// A due-south bearing carries over the pole once the radius reaches it, so a
// large enough ring near a pole puts its label on the far side.
export function ringLabelPosition(centre: GeoPosition, radiusM: number): GeoPosition {
  return destinationDegrees(centre, 180, radiusM);
}
