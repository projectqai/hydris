import { derivePath } from "@hydris/map-engine/geometry/path-geometry";
import { ringLabelPosition, ringRadii } from "@hydris/map-engine/geometry/range-rings";
import { rectangleCorners, rectangleSides } from "@hydris/map-engine/geometry/rectangle";
import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import type { GeoPosition } from "@hydris/map-engine/types";
import { geodesicMidpoint } from "@hydris/map-engine/utils/geodesic-path";
import { initialBearing } from "@hydris/map-engine/utils/geodesy";

import {
  formatArea,
  formatElevationAngle,
  formatRangeReadout,
  formatTrueBearing,
  formatVerticalRate,
} from "./format-kinematics";
import { TOOL } from "./map-paths";
import { computeCentroid } from "./transform-entities";

// A rectangle's taps are not its sides. The third only contributes its distance
// square to the first edge, so labelling the tap legs puts a number on a line the
// shape does not have. Label the sides it was built from instead.
function rectangleSideSegments(pathId: string, positions: readonly (GeoPosition | null)[]) {
  const [first, second, third] = positions;
  if (!first || !second || !third) return null;
  const sides = rectangleSides(rectangleCorners(first, second, third));

  return sides.map(({ source, target, groundDistanceM }, index) => {
    const from = { latitude: source.lat, longitude: source.lng };
    const to = { latitude: target.lat, longitude: target.lng };
    const bearingDegrees = initialBearing(from, to);
    const midpoint = geodesicMidpoint(source, target);
    return {
      pathId,
      source,
      target,
      sourceIndex: index,
      sourceAnchored: false,
      targetAnchored: false,
      groundDistanceM,
      position: midpoint,
      labelBearingDegrees: midpoint.bearingDegrees,
      label: `${formatRangeReadout(groundDistanceM, null)} · ${formatTrueBearing(bearingDegrees)}`,
      bearingDegrees,
      unresolved: false,
    };
  });
}

export function buildPathLayerData(
  path: MapPath,
  anchorPositions: ReadonlyMap<string, GeoPosition>,
  anchorVerticalRates: ReadonlyMap<string, number>,
) {
  const derived = derivePath(path.points, anchorPositions, path.kind, path.radiusM);
  const unresolvedAnchorIds = new Set(derived.unresolvedEntityIds);
  const vertices = derived.positions.flatMap((position, index) => {
    if (!position) return [];
    const point = path.points[index];
    return [
      {
        pathId: path.id,
        position,
        sourceIndex: index,
        anchored: point?.type === "entity",
        unresolved: point?.type === "entity" && unresolvedAnchorIds.has(point.entityId),
        ...(point?.type === "entity" ? { entityId: point.entityId } : {}),
      },
    ];
  });
  const sides =
    path.kind === "rectangle" ? rectangleSideSegments(path.id, derived.positions) : null;
  const segments =
    sides ??
    derived.segments.flatMap((segment, index) => {
      const source = derived.positions[index];
      const target = derived.positions[index + 1];
      if (!segment || !source || !target) return [];
      const sourcePoint = path.points[index];
      const targetPoint = path.points[index + 1];
      const unresolved =
        (sourcePoint?.type === "entity" && unresolvedAnchorIds.has(sourcePoint.entityId)) ||
        (targetPoint?.type === "entity" && unresolvedAnchorIds.has(targetPoint.entityId));
      const targetVerticalRate =
        targetPoint?.type === "entity" ? anchorVerticalRates.get(targetPoint.entityId) : undefined;
      const midpoint = geodesicMidpoint(source, target);
      return [
        {
          pathId: path.id,
          source,
          target,
          sourceIndex: index,
          sourceAnchored: sourcePoint?.type === "entity",
          targetAnchored: targetPoint?.type === "entity",
          groundDistanceM: segment.groundDistanceM,
          position: midpoint,
          labelBearingDegrees: midpoint.bearingDegrees,
          label: `${formatRangeReadout(segment.groundDistanceM, segment.slantDistanceM)}${
            path.kind === "rb-circle" ? "" : ` · ${formatTrueBearing(segment.bearingDegrees)}`
          }${
            segment.elevationAngleDegrees === null
              ? ""
              : ` · ${formatElevationAngle(segment.elevationAngleDegrees)}`
          }${targetVerticalRate === undefined ? "" : ` · ${formatVerticalRate(targetVerticalRate)}`}`,
          bearingDegrees: segment.bearingDegrees,
          unresolved,
        },
      ];
    });
  // a total is distance along a path, and a rectangle's points are corners it is
  // rebuilt from rather than a route a person walked
  const totalLabel =
    !TOOL[path.kind].pointsAreOutline &&
    derived.segments.length > 1 &&
    derived.totalGroundDistanceM !== null
      ? `Σ ${formatRangeReadout(derived.totalGroundDistanceM, derived.totalSlantDistanceM)}${
          derived.areaM2 === null ? "" : ` · ${formatArea(derived.areaM2)}`
        }`
      : null;
  // closed outlines repeat their first point, which would pull the centroid
  // toward that corner if it were counted twice
  const ring = derived.positions.flatMap((position) => (position ? [position] : []));
  const totalPosition =
    derived.areaM2 !== null && ring.length > 0
      ? computeCentroid(ring.slice(0, -1))
      : vertices.at(-1)?.position;

  // a ring set reads by its rings, so each one is labelled with how far out it
  // is rather than the path carrying a single total
  const ringTotals =
    path.rings === undefined
      ? []
      : ringRadii(derived.totalGroundDistanceM ?? 0, path.rings).map((radiusM) => ({
          position: ringLabelPosition(derived.positions[0]!, radiusM),
          label: formatRangeReadout(radiusM, null),
        }));

  return {
    id: path.id,
    kind: path.kind,
    vertices,
    segments,
    totals: ringTotals.length
      ? ringTotals
      : totalLabel && totalPosition
        ? [{ position: totalPosition, label: totalLabel }]
        : [],
    closed: derived.areaM2 !== null,
    closable: TOOL[path.kind].finishesAt === null && path.points.length >= 3,
    endsByGesture: TOOL[path.kind].finishesAt === null,
    drawsAsPath: TOOL[path.kind].drawsAsPath,
    verticesWhenLocked: TOOL[path.kind].verticesWhenLocked,
    anchors: TOOL[path.kind].anchors,
    pointsAreOutline: TOOL[path.kind].pointsAreOutline,
    rings: path.rings,
  };
}
