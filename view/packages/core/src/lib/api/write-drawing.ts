import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { derivePath, isCentreAndRadius } from "@hydris/map-engine/geometry/path-geometry";
import { ringRadii, ringRadius } from "@hydris/map-engine/geometry/range-rings";
import { rectangleCorners, rectangleSides } from "@hydris/map-engine/geometry/rectangle";
import type { EditKind, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { ellipsoidPolygonArea, geodesicDistance } from "@hydris/map-engine/utils/geodesy";
import {
  PlanarCircleSchema,
  PlanarGeometryCollectionSchema,
  PlanarGeometrySchema,
  PlanarPointSchema,
  PlanarPolygonSchema,
  PlanarRingSchema,
} from "@projectqai/proto/geometry";
import {
  MetricComponentSchema,
  MetricKind,
  MetricSchema,
  MetricUnit,
} from "@projectqai/proto/metrics";
import { GeometrySchema, GeoShapeComponentSchema } from "@projectqai/proto/world";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { roundBearing } from "../../features/aware/utils/format-kinematics";
import { DEFAULT_RINGS } from "../../features/aware/utils/map-paths";

// A vertex clicked onto an entity holds no position of its own, and its
// lastKnownPosition can still be a frame behind, so read the anchor live.
function anchorPosition(entityId: string, fallback?: GeoPosition): GeoPosition | undefined {
  const geo = useEntityStore.getState().entities.get(entityId)?.geo;
  if (!geo) return fallback;
  return { lat: geo.latitude, lng: geo.longitude, alt: geo.altitude };
}

function resolvePosition(point: PathPoint | undefined): GeoPosition | undefined {
  if (!point) return undefined;
  return point.type === "coordinate"
    ? point.position
    : anchorPosition(point.entityId, point.lastKnownPosition);
}

// An anchored point still gets a position written. We ignore it on read and
// resolve the entity instead, but it is all another reader has to draw with.
// Defaulting a missing position to zero saves the shape at 0,0.
function toPlanarPoint(point: PathPoint) {
  const position = resolvePosition(point);
  if (!position) throw new Error("An anchored point has lost its entity");

  return create(PlanarPointSchema, {
    latitude: position.lat,
    longitude: position.lng,
    ...(position.alt === undefined ? {} : { altitude: position.alt }),
    ...(point.type === "entity" ? { entity: point.entityId } : {}),
  });
}

function toPlane(
  kind: EditKind,
  points: readonly PathPoint[],
  rings = DEFAULT_RINGS,
  radiusM?: number,
) {
  const positions = points.flatMap((point) =>
    point.type === "coordinate" ? [point.position] : [],
  );

  switch (kind) {
    // a freeform is the same geometry, open or closed by a repeated first point
    case "range":
    case "freeform":
      if (points.length < 2) throw new Error("A line needs at least two points");
      return {
        case: "line" as const,
        value: create(PlanarRingSchema, { points: points.map(toPlanarPoint) }),
      };

    case "rectangle": {
      const [first, second, depth] = positions;
      if (!first || !second || !depth) throw new Error("A rectangle needs three corners");
      const corners = rectangleCorners(first, second, depth);
      return {
        case: "polygon" as const,
        value: create(PlanarPolygonSchema, {
          outer: create(PlanarRingSchema, {
            points: [...corners, corners[0]!].map((position) =>
              create(PlanarPointSchema, { latitude: position.lat, longitude: position.lng }),
            ),
          }),
        }),
      };
    }

    // one circle per ring, each a whole multiple of the bounded spacing
    case "rb-circle": {
      const [centreVertex, edgeVertex] = points;
      const centre = resolvePosition(centreVertex);
      const edge = resolvePosition(edgeVertex);
      if (!centreVertex || !centre || !edge) {
        throw new Error("A ring set needs a centre and a radius");
      }
      const radius = radiusM ?? ringRadius(centre, edge);
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error("A ring set needs a positive radius");
      }
      if (!Number.isInteger(rings) || rings <= 0) {
        throw new Error("A ring set needs a positive whole number of rings");
      }
      return {
        case: "collection" as const,
        value: create(PlanarGeometryCollectionSchema, {
          geometries: ringRadii(radius, rings).map((ringRadiusM) =>
            create(PlanarGeometrySchema, {
              plane: {
                case: "circle",
                value: create(PlanarCircleSchema, {
                  center: toPlanarPoint(centreVertex),
                  radiusM: ringRadiusM,
                }),
              },
            }),
          ),
        }),
      };
    }

    case "circle": {
      const [centreVertex, edgeVertex] = points;
      const centre = resolvePosition(centreVertex);
      const edge = resolvePosition(edgeVertex);
      if (!centreVertex || !centre || !edge) {
        throw new Error("A circle needs a centre and a radius");
      }
      const radius =
        radiusM ??
        geodesicDistance(
          { latitude: centre.lat, longitude: centre.lng },
          { latitude: edge.lat, longitude: edge.lng },
        );
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error("A circle needs a positive radius");
      }
      return {
        case: "circle" as const,
        value: create(PlanarCircleSchema, {
          center: toPlanarPoint(centreVertex),
          radiusM: radius,
        }),
      };
    }
  }
}

// kind is optional: the enum has no bearing value.
type MetricSpec = { label: string; unit: MetricUnit; kind?: MetricKind; value: number };

// A published number is read next to the same quantity on the map, so both
// switch unit at the same point rather than one showing 5,040.04 m where the
// other shows 5.04 km.
function lengthSpec(label: string, metres: number): MetricSpec {
  const kind = MetricKind.MetricKindDistance;
  return metres < 1000
    ? { label, unit: MetricUnit.MetricUnitMeter, kind, value: metres }
    : { label, unit: MetricUnit.MetricUnitKilometer, kind, value: metres / 1000 };
}

const toGeoPoint = (position: GeoPosition) => ({
  latitude: position.lat,
  longitude: position.lng,
});

// Square metres run to seven figures before they are a kilometre across, so an
// area switches unit at the same point its map label does.
function areaSpec(areaM2: number): MetricSpec {
  const kind = MetricKind.MetricKindArea;
  return areaM2 < 100_000
    ? { label: "Area", unit: MetricUnit.MetricUnitSquareMeter, kind, value: areaM2 }
    : {
        label: "Area",
        unit: MetricUnit.MetricUnitSquareKilometer,
        kind,
        value: areaM2 / 1_000_000,
      };
}

// What a shape's own geometry says about it, published for the details panel
// and downstream readers.
function metricSpecs(
  kind: EditKind,
  points: readonly PathPoint[],
  rings = DEFAULT_RINGS,
  radiusM?: number,
): MetricSpec[] {
  const derived = derivePath(points, new Map(), kind, radiusM);
  const lengthM = derived.totalGroundDistanceM;
  const bearing = derived.segments[0]?.bearingDegrees;

  switch (kind) {
    case "range":
      return lengthM === null
        ? []
        : [
            lengthSpec("Ground Distance", lengthM),
            ...(bearing === undefined
              ? []
              : [
                  {
                    label: "Bearing",
                    unit: MetricUnit.MetricUnitDegree,
                    value: roundBearing(bearing),
                  },
                ]),
          ];
    case "freeform":
      return lengthM === null
        ? []
        : [
            lengthSpec(derived.areaM2 === null ? "Length" : "Perimeter", lengthM),
            ...(derived.areaM2 === null ? [] : [areaSpec(derived.areaM2)]),
          ];
    case "circle": {
      const radius = radiusM ?? lengthM;
      return radius === null ? [] : [lengthSpec("Radius", radius)];
    }
    case "rb-circle": {
      const radii = ringRadii(radiusM ?? lengthM ?? 0, rings);
      const spacingM = radii[0];
      const outerRadiusM = radii.at(-1);
      if (spacingM === undefined || outerRadiusM === undefined) return [];
      return [
        lengthSpec("Radius", spacingM),
        {
          label: "Rings",
          unit: MetricUnit.MetricUnitCount,
          kind: MetricKind.MetricKindCount,
          value: radii.length,
        },
        lengthSpec("Outer Radius", outerRadiusM),
      ];
    }
    case "rectangle": {
      const [first, second, third] = derived.positions;
      if (!first || !second || !third) return [];
      const corners = rectangleCorners(first, second, third);
      const [width, depth] = rectangleSides(corners);
      // the third tap contributes only its distance square to the first edge, so
      // its raw distance is not the depth the rectangle was built with
      return [
        lengthSpec("Width", width.groundDistanceM),
        lengthSpec("Depth", depth.groundDistanceM),
        areaSpec(ellipsoidPolygonArea([...corners, corners[0]!].map(toGeoPoint))),
      ];
    }
  }
}

// Circle and ring-set metrics stay fixed when their anchored centre moves.
// Every other metric would be stale as soon as its anchor moved.
export function writeMetrics(
  kind: EditKind,
  points: readonly PathPoint[],
  rings?: number,
  radiusM?: number,
) {
  if (!isCentreAndRadius(kind) && points.some((point) => point.type === "entity")) {
    return undefined;
  }
  const specs = metricSpecs(kind, points, rings, radiusM);
  if (specs.length === 0) return undefined;

  return create(MetricComponentSchema, {
    metrics: specs.map((spec, index) =>
      create(MetricSchema, {
        id: index + 1,
        label: spec.label,
        unit: spec.unit,
        ...(spec.kind === undefined ? {} : { kind: spec.kind }),
        measuredAt: timestampNow(),
        val: { case: "double", value: spec.value },
      }),
    ),
  });
}

export function writeDrawing(
  kind: EditKind,
  points: readonly PathPoint[],
  rings?: number,
  radiusM?: number,
) {
  return create(GeoShapeComponentSchema, {
    geometry: create(GeometrySchema, {
      planar: create(PlanarGeometrySchema, { plane: toPlane(kind, points, rings, radiusM) }),
    }),
  });
}
