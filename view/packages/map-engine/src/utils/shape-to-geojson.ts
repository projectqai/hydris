import { AFFILIATION_COLORS_RGB } from "../constants";
import type {
  Affiliation,
  GeoPosition,
  ShapeFeature,
  ShapeGeometry,
  ShapeProperties,
} from "../types";
import { splitAtAntimeridian, splitRingAtAntimeridian } from "./geodesic-path";

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
    const first = outer[0];
    const last = outer.at(-1);
    if (first && (!last || first[0] !== last[0] || first[1] !== last[1])) outer.push(first);
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

// With both poles inside, the rim bounds an excluded region. Its seam cuts
// become notches in the map boundary rather than holes that cross that boundary.
function complementPolygon(rings: GeoPosition[][]): Extract<ShapeGeometry, { type: "polygon" }> {
  const outer: GeoPosition[] = [];
  const holes: GeoPosition[][] = [];
  const cuts = rings.flatMap((ring) => {
    const first = ring[0];
    const last = ring.at(-1);
    if (!first || !last) return [];
    if (first.lat === last.lat && first.lng === last.lng) {
      holes.push(ring);
      return [];
    }
    return [{ ring, first, last }];
  });
  for (const lng of [180, -180]) {
    const direction = lng === 180 ? 1 : -1;
    outer.push({ lng: 0, lat: -90 * direction }, { lng, lat: -90 * direction });
    const side = cuts
      .filter((cut) => cut.first.lng === lng)
      .map(({ ring, first, last }) => ({
        ring: (last.lat - first.lat) * direction > 0 ? ring : [...ring].reverse(),
        latitude: direction > 0 ? Math.min(first.lat, last.lat) : Math.max(first.lat, last.lat),
      }))
      .sort((a, b) => (a.latitude - b.latitude) * direction);
    for (const { ring } of side) {
      for (const point of ring) outer.push(point);
    }
    outer.push({ lng, lat: 90 * direction });
  }
  return { type: "polygon", outer, holes };
}

function collectFeatures(
  id: string,
  shape: ShapeGeometry,
  affiliation: Affiliation,
  drawn: boolean,
  out: ShapeFeature[],
  collectionMember = false,
  split = false,
): void {
  if (shape.type === "collection") {
    for (const sub of shape.geometries) {
      collectFeatures(id, sub, affiliation, drawn, out, true, split);
    }
  } else {
    const feature = shapeToSingleFeature(id, shape, affiliation);
    if (collectionMember) feature.properties.collectionMember = true;
    if (drawn) feature.properties.drawn = true;
    if (shape.type === "polygon" && (split || shape.enclosedPoles) && !shape.holes?.length) {
      const first = shape.outer[0];
      const last = shape.outer.at(-1);
      const ring =
        first && (first.lat !== last?.lat || first.lng !== last.lng)
          ? [...shape.outer, first]
          : shape.outer;
      const outlines = splitAtAntimeridian(ring);
      if (outlines.length > 1 || shape.enclosedPoles) {
        const pole = shape.enclosedPoles === "both" ? undefined : shape.enclosedPoles;
        const rings = splitRingAtAntimeridian(ring, pole);
        const polygons =
          shape.enclosedPoles === "both"
            ? [complementPolygon(rings)]
            : rings.map((outer) => ({ ...shape, outer }));
        for (const polygon of polygons) {
          const fill = shapeToSingleFeature(id, polygon, affiliation);
          fill.properties = { ...feature.properties, fillOnly: true };
          out.push(fill);
        }
        for (const outline of outlines) {
          out.push({
            type: "Feature",
            properties: feature.properties,
            geometry: {
              type: "LineString",
              coordinates: outline.map((point) => [point.lng, point.lat]),
            },
          });
        }
        return;
      }
    }
    if (split && shape.type === "polyline") {
      for (const piece of splitAtAntimeridian(shape.points)) {
        out.push({
          ...feature,
          geometry: {
            type: "LineString",
            coordinates: piece.map((point) => [point.lng, point.lat]),
          },
        });
      }
      return;
    }
    out.push(feature);
  }
}

export function shapeToFeatures(
  id: string,
  shape: ShapeGeometry,
  affiliation: Affiliation,
  drawn = false,
  split = true,
): ShapeFeature[] {
  const out: ShapeFeature[] = [];
  collectFeatures(id, shape, affiliation, drawn, out, false, split);
  return out;
}
