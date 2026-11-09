import type { GeoPosition } from "../types";
import { destinationDegrees } from "../utils/geodesic-circle";
import { finalBearing, geodesicDistance, initialBearing } from "../utils/geodesy";

const RIGHT_ANGLE = 90;

// the third tap only contributes its distance perpendicular to the first edge,
// so it does not have to land on a corner
export function rectangleCorners(
  first: GeoPosition,
  second: GeoPosition,
  depthPoint: GeoPosition,
): [GeoPosition, GeoPosition, GeoPosition, GeoPosition] {
  const firstEdgeBearing = initialBearing(
    { latitude: first.lat, longitude: first.lng },
    { latitude: second.lat, longitude: second.lng },
  );
  const secondEdgeBearing = finalBearing(
    { latitude: first.lat, longitude: first.lng },
    { latitude: second.lat, longitude: second.lng },
  );
  const toDepth = initialBearing(
    { latitude: second.lat, longitude: second.lng },
    { latitude: depthPoint.lat, longitude: depthPoint.lng },
  );
  const distance = geodesicDistance(
    { latitude: second.lat, longitude: second.lng },
    { latitude: depthPoint.lat, longitude: depthPoint.lng },
  );

  // the component of the third tap that lies square to the first edge
  const offAxis = ((toDepth - (secondEdgeBearing + RIGHT_ANGLE)) * Math.PI) / 180;
  const depth = distance * Math.cos(offAxis);
  const direction = depth < 0 ? -RIGHT_ANGLE : RIGHT_ANGLE;

  return [
    first,
    second,
    destinationDegrees(second, secondEdgeBearing + direction, Math.abs(depth)),
    destinationDegrees(first, firstEdgeBearing + direction, Math.abs(depth)),
  ];
}

export function rectangleSides(corners: ReturnType<typeof rectangleCorners>) {
  const [a, b, c] = corners;
  return [
    {
      source: a,
      target: b,
      groundDistanceM: geodesicDistance(
        { latitude: a.lat, longitude: a.lng },
        { latitude: b.lat, longitude: b.lng },
      ),
    },
    {
      source: b,
      target: c,
      groundDistanceM: geodesicDistance(
        { latitude: b.lat, longitude: b.lng },
        { latitude: c.lat, longitude: c.lng },
      ),
    },
  ] as const;
}
