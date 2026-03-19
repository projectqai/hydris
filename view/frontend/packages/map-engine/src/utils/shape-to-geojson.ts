import { AFFILIATION_COLORS_RGB } from "../constants";
import type { Affiliation, ShapeFeature, ShapeGeometry, ShapeProperties } from "../types";

function shapeToSingleFeature(
  id: string,
  shape: Exclude<ShapeGeometry, { type: "collection" }>,
  affiliation: Affiliation,
): ShapeFeature {
  const color = AFFILIATION_COLORS_RGB[affiliation];
  const properties: ShapeProperties = {
    id,
    color,
    affiliation,
    lineStyle: shape.type === "point" ? undefined : shape.lineStyle,
  };

  if (shape.type === "polygon") {
    const outer = shape.outer.map((p) => [p.lng, p.lat] as [number, number]);
    if (outer.length > 0 && outer[0]) {
      outer.push(outer[0]);
    }
    const coordinates: [number, number][][] = [outer];
    if (shape.holes) {
      for (const hole of shape.holes) {
        const holeCoords = hole.map((p) => [p.lng, p.lat] as [number, number]);
        if (holeCoords.length > 0 && holeCoords[0]) {
          holeCoords.push(holeCoords[0]);
        }
        coordinates.push(holeCoords);
      }
    }
    return {
      type: "Feature",
      properties,
      geometry: { type: "Polygon", coordinates },
    };
  }

  if (shape.type === "polyline") {
    return {
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates: shape.points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    };
  }

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Point",
      coordinates: [shape.position.lng, shape.position.lat],
    },
  };
}

function collectFeatures(
  id: string,
  shape: ShapeGeometry,
  affiliation: Affiliation,
  out: ShapeFeature[],
): void {
  if (shape.type === "collection") {
    for (const sub of shape.geometries) {
      collectFeatures(id, sub, affiliation, out);
    }
  } else {
    out.push(shapeToSingleFeature(id, shape, affiliation));
  }
}

export function shapeToFeatures(
  id: string,
  shape: ShapeGeometry,
  affiliation: Affiliation,
): ShapeFeature[] {
  const out: ShapeFeature[] = [];
  collectFeatures(id, shape, affiliation, out);
  return out;
}
