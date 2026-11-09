import { AFFILIATION_COLORS_RGB } from "../constants";
import type { PathLayerData } from "../layers/path-logic";
import type {
  Affiliation,
  DrawingKind,
  EditKind,
  GeoPosition,
  ShapeFeature,
  ShapeGeometry,
} from "../types";
import { circleToPolygon } from "../utils/geodesic-circle";
import { densifyGeodesicPath, type GeodesicViewport } from "../utils/geodesic-path";
import { geodesicDistance } from "../utils/geodesy";
import { shapeToFeatures } from "../utils/shape-to-geojson";
import { ringRadii, ringRadius } from "./range-rings";
import { rectangleCorners } from "./rectangle";

type DrawingPreviewInput = {
  kind: EditKind;
  vertices: readonly { position: GeoPosition }[];
  rings?: number;
  aim?: GeoPosition;
  zoom?: number;
  viewport?: GeodesicViewport;
};

type SampledPreview = {
  key: string;
  shape?: ShapeGeometry | null;
  features?: ShapeFeature[];
  viewport?: GeodesicViewport;
};

const sampledPreviews = new WeakMap<
  GeoPosition | DrawingPreviewInput["vertices"],
  SampledPreview
>();

function sampledPreviewForPath({
  kind,
  vertices,
  rings,
  aim,
  zoom,
  viewport,
}: DrawingPreviewInput): SampledPreview {
  const points = [...vertices.map((vertex) => vertex.position), ...(aim ? [aim] : [])];
  const key = `${kind}:${rings}:${zoom === undefined ? "" : Math.ceil(zoom)}:${points.map((point) => `${point.lat},${point.lng}`).join(":")}`;
  // Layer vertices are rebuilt on parent renders; their source positions remain stable.
  const cacheKey = vertices[0]?.position ?? vertices;
  const cached = sampledPreviews.get(cacheKey);
  if (cached?.key === key && cached.viewport === viewport) return cached;
  const preview = { key, viewport };
  sampledPreviews.set(cacheKey, preview);
  return preview;
}

export function drawingPreviewForPath(input: DrawingPreviewInput): ShapeGeometry | null {
  const { kind, vertices, rings, aim, zoom, viewport } = input;
  if (kind === "range") return null;
  const cached = sampledPreviewForPath(input);
  if (cached.shape === undefined) {
    const points = [...vertices.map((vertex) => vertex.position), ...(aim ? [aim] : [])];
    cached.shape = drawingPreviewShape(kind, points, rings, zoom, viewport);
  }
  return cached.shape;
}

export function drawingPreviewFeatures(
  {
    data,
    path,
    aim,
    zoom,
    viewport,
    affiliation = "unclassified",
  }: {
    data?: PathLayerData | null;
    path?: Pick<DrawingPreviewInput, "kind" | "vertices" | "rings"> & { id: string };
    aim?: GeoPosition;
    zoom?: number;
    viewport?: GeodesicViewport;
    affiliation?: Affiliation;
  },
  preparedFeatures?: ShapeFeature[],
): ShapeFeature[] {
  const placed = path ?? data?.paths.find((path) => path.id === data.drawingId);
  if (!placed || placed.vertices.length === 0) return [];

  const input = { ...placed, aim, zoom, viewport };
  const cached = sampledPreviewForPath(input);
  if (preparedFeatures !== undefined) cached.features = preparedFeatures;
  if (cached.features === undefined) {
    const shape = drawingPreviewForPath(input);
    cached.features = shape
      ? shapeToFeatures(placed.id, shape, "unclassified", true, zoom !== undefined)
      : [];
  }
  // Geometry stays cached; presentation belongs to the current entity, not the worker job.
  return cached.features.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      id: placed.id,
      affiliation,
      color: AFFILIATION_COLORS_RGB[affiliation],
    },
  }));
}

export function drawingPreviewShape(
  kind: DrawingKind,
  points: readonly GeoPosition[],
  rings = 1,
  zoom?: number,
  viewport?: GeodesicViewport,
): ShapeGeometry | null {
  switch (kind) {
    case "circle": {
      const [centre, edge] = points;
      if (!centre || !edge) return null;
      const radiusM = geodesicDistance(
        { latitude: centre.lat, longitude: centre.lng },
        { latitude: edge.lat, longitude: edge.lng },
      );
      return radiusM > 0
        ? circleToPolygon(centre, radiusM, undefined, undefined, zoom, viewport)
        : null;
    }

    // the path layer already draws this shape, so only the leg to the pointer
    // is left to preview
    case "freeform":
      return null;

    case "rb-circle": {
      const [centre, edge] = points;
      if (!centre || !edge) return null;
      const geometries = ringRadii(ringRadius(centre, edge), rings).map(
        (radiusM): ShapeGeometry =>
          circleToPolygon(centre, radiusM, undefined, undefined, zoom, viewport),
      );
      return geometries.length ? { type: "collection", geometries } : null;
    }

    case "rectangle": {
      const [first, second, depth] = points;
      if (!first || !second) return null;
      // before the third tap there is only an edge to show
      if (!depth)
        return {
          type: "polyline",
          points:
            zoom === undefined
              ? [first, second]
              : densifyGeodesicPath(first, second, zoom, undefined, viewport),
        };
      const corners = rectangleCorners(first, second, depth);
      const outer =
        zoom === undefined
          ? [...corners]
          : corners.flatMap((source, index) => {
              const target = corners[(index + 1) % corners.length];
              return target
                ? densifyGeodesicPath(source, target, zoom, undefined, viewport).slice(0, -1)
                : [];
            });
      return { type: "polygon", outer: [...outer, corners[0]] };
    }
  }
}
