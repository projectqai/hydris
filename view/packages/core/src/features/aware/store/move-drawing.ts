import { drawingPreviewShape } from "@hydris/map-engine/geometry/drawing-preview";
import { isCentreAndRadius } from "@hydris/map-engine/geometry/path-geometry";
import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import type { GeoPosition, ShapeGeometry } from "@hydris/map-engine/types";
import type { Entity } from "@projectqai/proto/world";

import { updateDrawing } from "../../../lib/api/use-entity-mutation";
import type { PlacementContextValue } from "../placement-context";
import { translatePath } from "../utils/map-paths";
import { buildPathLayerData } from "../utils/path-layer-data";
import { readDrawing, shapeCentroid } from "../utils/transform-entities";
import { liveAnchors } from "./edit-store";

export function prepareDrawingMove(
  entity: Entity,
  anchorPositions: ReadonlyMap<string, GeoPosition> = new Map(),
): { path: MapPath; centroid: GeoPosition } | null {
  const shape = readDrawing(entity);
  if (!shape) return null;

  const source: MapPath = {
    id: entity.id,
    kind: shape.kind,
    points: shape.points,
    ...(shape.rings === undefined ? {} : { rings: shape.rings }),
    ...(shape.radiusM === undefined ? {} : { radiusM: shape.radiusM }),
  };
  const rendered = buildPathLayerData(source, anchorPositions, new Map());
  const positions = rendered.vertices.map((vertex) => vertex.position);
  if (positions.length !== shape.points.length) return null;

  let geometry: ShapeGeometry | null;
  if (isCentreAndRadius(shape.kind)) {
    const centre = positions[0];
    if (!centre) return null;
    geometry = { type: "point", position: centre };
  } else if (shape.kind === "range") {
    geometry = { type: "polyline", points: positions };
  } else if (shape.kind === "freeform") {
    geometry = rendered.closed
      ? { type: "polygon", outer: positions.slice(0, -1) }
      : { type: "polyline", points: positions };
  } else {
    geometry = drawingPreviewShape(shape.kind, positions, shape.rings);
  }
  if (!geometry) return null;
  // closed outlines repeat their first point, which would pull the centroid
  // toward that corner if it were counted twice
  if (geometry.type === "polygon") {
    const first = geometry.outer[0];
    const last = geometry.outer.at(-1);
    if (first && last && first.lat === last.lat && first.lng === last.lng) {
      geometry = { ...geometry, outer: geometry.outer.slice(0, -1) };
    }
  }
  const centroid = shapeCentroid(geometry);
  if (!centroid) return null;

  return {
    centroid,
    path: {
      ...source,
      // moving a shape detaches its anchors, so every resolved vertex becomes fixed
      points: positions.map((position) => ({ type: "coordinate", position })),
    },
  };
}

export function moveDrawing(
  entity: Entity,
  enterPlacement: PlacementContextValue["enterPlacement"],
): void {
  const shape = readDrawing(entity);
  if (!shape) return;

  const prepared = prepareDrawingMove(entity, liveAnchors(shape.points));
  if (!prepared) return;
  const { path, centroid } = prepared;

  enterPlacement(entity, {
    recenterAt: centroid,
    onConfirm: async (destination) => {
      const moved = translatePath(path, centroid, destination);
      await updateDrawing(entity, moved.kind, moved.points, moved.rings, moved.radiusM);
    },
  });
}
