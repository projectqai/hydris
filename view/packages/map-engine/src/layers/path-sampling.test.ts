import { WebMercatorViewport } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { Geodesic } from "geographiclib-geodesic";
import { describe, expect, it, vi } from "vitest";

import { drawingPreviewFeatures } from "../geometry/drawing-preview";
import type { GeoPosition } from "../types";
import { densifyGeodesicPieces } from "../utils/geodesic-path";
import { createRangeInteractionLayers } from "./path-layer";
import { type LayerPath, preparePathLayerData } from "./path-logic";

// GeographicLib 2.0: Direct(70, 13, 37, 100000), then Direct(endpoint, 143, 73000).
const A = { lat: 70, lng: 13 };
const B = { lat: 70.70860943684576, lng: 14.631661090228496 };
const C = { lat: 70.18229218428783, lng: 15.792329288666139 };
const LEGS = [
  { source: A, target: B, distanceM: 100_000, bearing: 37 },
  { source: B, target: C, distanceM: 73_000, bearing: 143 },
  { source: C, target: A, distanceM: 108_083.786572347, bearing: -99.5295615986701 },
];
const FIRST_LEG = { source: A, target: B, distanceM: 100_000, bearing: 37 };
type ReferenceLeg = typeof FIRST_LEG;

const CIRCLE_REFERENCE_CENTER = { lat: 70, lng: 37 };
// Independent WGS84 direct solutions: input edges at 37°, rim probes around 133.668°.
const CIRCLE_CULL_REFERENCES = [
  {
    radiusM: 19_995_000,
    edge: { lat: -69.94626379408679, lng: -143.24240084061796 },
    positions: [
      [-70.042415755666, -143.2800026275216],
      [-70.04241876477055, -143.27999426021773],
      [-70.04242177389636, -143.27998589212157],
      [-70.04242478304347, -143.27997752323313],
      [-70.04242779221184, -143.2799691535524],
      [-70.04243080140147, -143.2799607830794],
      [-70.04243381061235, -143.27995241181418],
      [-70.0424368198444, -143.27994403975643],
      [-70.0424398290977, -143.27993566690645],
      [-70.04244283837218, -143.27992729326408],
      [-70.0424458476678, -143.27991891882925],
      [-70.04244885698456, -143.27991054360194],
      [-70.04245186632247, -143.2799021675823],
      [-70.0424548756815, -143.2798937907701],
      [-70.0424578850616, -143.27988541316537],
      [-70.04246089446279, -143.27987703476813],
      [-70.04246390388505, -143.27986865557835],
    ],
  },
  {
    radiusM: 500_000,
    edge: { lat: 73.36778024475623, lng: 46.4479975128697 },
    positions: [
      [66.68775862140133, 45.2063963194445],
      [66.68775739945688, 45.206392469399646],
      [66.68775617751302, 45.20638861935383],
      [66.68775495556972, 45.206384769307064],
      [66.68775373362698, 45.20638091925933],
      [66.68775251168482, 45.20637706921063],
      [66.68775128974322, 45.20637321916098],
      [66.68775006780218, 45.206369369110355],
      [66.68774884586173, 45.20636551905878],
      [66.68774762392184, 45.206361669006235],
      [66.68774640198252, 45.206357818952746],
      [66.68774518004378, 45.20635396889828],
      [66.68774395810559, 45.206350118842856],
      [66.68774273616799, 45.20634626878647],
      [66.68774151423094, 45.206342418729136],
      [66.68774029229446, 45.20633856867083],
      [66.68773907035856, 45.20633471861156],
    ],
  },
] as const;

function project(position: GeoPosition) {
  return {
    x: position.lng / 360,
    y: Math.log(Math.tan(Math.PI / 4 + (position.lat * Math.PI) / 360)) / (2 * Math.PI),
  };
}

function referenceCurve(leg: ReferenceLeg, startM = 0, endM = leg.distanceM) {
  const line = Geodesic.WGS84.DirectLine(
    leg.source.lat,
    leg.source.lng,
    leg.bearing,
    leg.distanceM,
  );
  return Array.from({ length: 8192 }, (_, index) => {
    const { lat2, lon2 } = line.Position(startM + ((endM - startM) * index) / 8191);
    if (lat2 === undefined || lon2 === undefined) throw new Error("missing reference position");
    return project({ lat: lat2, lng: lon2 });
  });
}

function deviationPx(
  path: readonly GeoPosition[],
  reference: ReturnType<typeof referenceCurve>,
  zoom: number,
) {
  const projected = path.map(project);

  const segments = projected.slice(1).map((to, index) => {
    const from = projected[index];

    if (!from) throw new Error("missing rendered endpoint");

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    return { x: from.x, y: from.y, dx, dy, lengthSquared: dx * dx + dy * dy };
  });

  let maximumSquared = 0;

  for (const point of reference) {
    let nearestSquared = Infinity;

    for (const { x, y, dx, dy, lengthSquared } of segments) {
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / lengthSquared));

      const ex = point.x - x - t * dx;
      const ey = point.y - y - t * dy;

      nearestSquared = Math.min(nearestSquared, ex * ex + ey * ey);
    }

    maximumSquared = Math.max(maximumSquared, nearestSquared);
  }

  return Math.sqrt(maximumSquared) * 512 * 2 ** zoom;
}

function layerPath(kind: "range" | "freeform", id = "survey"): LayerPath {
  const legs = kind === "range" ? [FIRST_LEG] : LEGS;
  const positions = kind === "range" ? [A, B] : [A, B, C, A];
  return {
    id,
    kind,
    vertices: positions.map((position, sourceIndex) => ({
      pathId: id,
      position,
      sourceIndex,
      anchored: false,
      unresolved: false,
    })),
    segments: legs.map((leg, sourceIndex) => ({
      pathId: id,
      source: leg.source,
      target: leg.target,
      sourceIndex,
      sourceAnchored: false,
      targetAnchored: false,
      groundDistanceM: leg.distanceM,
      position: leg.source,
      label: `${leg.distanceM} m`,
      bearingDegrees: leg.bearing,
      unresolved: false,
    })),
    totals: [],
    closed: kind === "freeform",
    verticesWhenLocked: true,
  };
}

const ZOOMS = Array.from({ length: 49 }, (_, index) => -2 + index / 2);
const OUTLINE_KINDS: Array<"circle" | "rb-circle" | "rectangle"> = [
  "circle",
  "rb-circle",
  "rectangle",
];

function expectAccurate(
  path: readonly GeoPosition[],
  reference: ReturnType<typeof referenceCurve>,
  zoom: number,
  label: string,
) {
  const error = deviationPx(path, reference, zoom);
  expect(error, `${label} at z${zoom}: ${error.toFixed(6)} CSS px exceeds 0.5`).toBeLessThanOrEqual(
    0.5,
  );
}

describe("screen-space path sampling", () => {
  it("bounds off-screen subdivision through the layer and preview callers", () => {
    const viewport = { west: 12.999, east: 13.001, south: 69.999, north: 70.001 };
    for (const zoom of [10, 14, 18, 19, 22]) {
      for (const kind of ["range", "freeform"] as const) {
        const path = layerPath(kind);
        const data = preparePathLayerData(
          { paths: [path], drawingId: null },
          null,
          null,
          zoom,
          viewport,
        );
        const count = data.lineSegments.reduce((sum, segment) => sum + segment.path.length, 0);
        expect(count, `${kind} at z${zoom}: ${count} vertices`).toBeLessThan(256);
      }
      for (const kind of OUTLINE_KINDS) {
        const path = { ...layerPath("range"), kind, rings: 3 };
        if (kind === "rectangle")
          path.vertices.push({ ...path.vertices[1]!, position: C, sourceIndex: 2 });
        const features = drawingPreviewFeatures({
          data: { paths: [path], drawingId: path.id },
          zoom,
          viewport,
        });
        const count = features.reduce(
          (sum, feature) =>
            sum +
            (feature.geometry.type === "Polygon" ? feature.geometry.coordinates.flat().length : 0),
          0,
        );
        expect(count, `${kind} at z${zoom}: ${count} vertices`).toBeLessThan(1024);
      }
    }
  });

  it("bounds subdivision of a small rim near an antipode", () => {
    const path = {
      ...layerPath("range"),
      kind: "circle" as const,
      vertices: [
        { position: CIRCLE_REFERENCE_CENTER },
        { position: CIRCLE_CULL_REFERENCES[0].edge },
      ].map((vertex, sourceIndex) => ({
        ...vertex,
        sourceIndex,
        pathId: "survey",
        anchored: false,
        unresolved: false,
      })),
    };
    for (const zoom of [14, 19, 22]) {
      const camera = new WebMercatorViewport({
        latitude: -70.0424398290977,
        longitude: -143.27993566690645,
        zoom,
        width: 1200,
        height: 800,
      });
      const [west, south, east, north] = camera.getBounds();
      const features = drawingPreviewFeatures({
        data: { paths: [path], drawingId: path.id },
        zoom,
        viewport: { west, south, east, north },
      });
      const count = features
        .filter((feature) => !feature.properties.fillOnly)
        .reduce(
          (sum, feature) =>
            sum +
            (feature.geometry.type === "Polygon"
              ? feature.geometry.coordinates.flat().length
              : feature.geometry.type === "LineString"
                ? feature.geometry.coordinates.length
                : 0),
          0,
        );
      expect(count, `near-antipodal rim at z${zoom}: ${count} vertices`).toBeLessThan(1024);
    }
  });

  it.each(CIRCLE_CULL_REFERENCES)(
    "keeps the visible circle rim accurate at radius $radiusM",
    ({ edge, positions }) => {
      const path = {
        ...layerPath("range"),
        kind: "circle" as const,
        vertices: [CIRCLE_REFERENCE_CENTER, edge].map((position, sourceIndex) => ({
          position,
          sourceIndex,
          pathId: "survey",
          anchored: false,
          unresolved: false,
        })),
      };
      const reference = positions.map(([lat, lng]) => project({ lat, lng }));
      const [latitude, longitude] = positions[8];
      for (const zoom of [14, 19, 22]) {
        const camera = new WebMercatorViewport({
          latitude,
          longitude,
          zoom,
          width: 1200,
          height: 800,
        });
        const [west, south, east, north] = camera.getBounds();
        const min = project({ lat: south, lng: west });
        const max = project({ lat: north, lng: east });
        const visibleReference = reference.filter(
          (point) => point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y,
        );
        expect(visibleReference.length).toBeGreaterThanOrEqual(9);
        const features = drawingPreviewFeatures({
          data: { paths: [path], drawingId: path.id },
          zoom,
          viewport: { west, south, east, north },
        });
        const outline = features.find((feature) => !feature.properties.fillOnly);
        const coordinates =
          outline?.geometry.type === "LineString"
            ? outline.geometry.coordinates
            : outline?.geometry.type === "Polygon"
              ? outline.geometry.coordinates[0]
              : undefined;
        if (!coordinates) throw new Error("missing circle rim");
        const boundary = coordinates.map((position) => ({ lng: position[0]!, lat: position[1]! }));
        expectAccurate(boundary, visibleReference, zoom, "visible circle rim");
      }
    },
  );

  it("keeps partially visible range, open path and closed path edges accurate", () => {
    for (const closed of [undefined, false, true]) {
      const path = layerPath(closed === undefined ? "range" : "freeform");
      if (closed === false) {
        path.closed = false;
        path.vertices.pop();
        path.segments.pop();
      }
      for (const leg of closed === undefined ? [FIRST_LEG] : LEGS.slice(0, 2)) {
        const line = Geodesic.WGS84.DirectLine(
          leg.source.lat,
          leg.source.lng,
          leg.bearing,
          leg.distanceM,
        );
        const middleM = leg.distanceM * 0.3713;
        const centre = line.Position(middleM);
        for (const zoom of [10, 14, 19, 22]) {
          const camera = new WebMercatorViewport({
            latitude: centre.lat2,
            longitude: centre.lon2,
            zoom,
            width: 1200,
            height: 800,
          });
          const [west, south, east, north] = camera.getBounds();
          const viewport = { west, south, east, north };
          const spanM = leg.distanceM / 2 ** (zoom - 9);
          const reference = referenceCurve(
            leg,
            Math.max(0, middleM - spanM),
            Math.min(leg.distanceM, middleM + spanM),
          ).filter((point) => {
            const min = project({ lat: south, lng: west });
            const max = project({ lat: north, lng: east });
            return point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y;
          });
          expect(reference.length).toBeGreaterThan(100);
          const data = preparePathLayerData(
            { paths: [path], drawingId: null },
            null,
            null,
            zoom,
            viewport,
          );
          const index = path.segments.findIndex((segment) => segment.source === leg.source);
          const stroke = data.lineSegments[index];
          if (!stroke) throw new Error("missing visible stroke");
          expectAccurate(stroke.path, reference, zoom, "partially visible stroke");
          if (closed)
            expectAccurate(data.fills[0]!.ring, reference, zoom, "partially visible fill");
        }
      }
    }
  });

  it("returns an explicit two-point fallback instead of throwing for an invalid zoom", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(densifyGeodesicPieces(A, B, Number.NaN)).toEqual([[A, B]]);
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("keeps the range stroke within half a CSS pixel across the camera zoom range", () => {
    const path = layerPath("range");
    const reference = referenceCurve(FIRST_LEG);
    for (const zoom of ZOOMS) {
      const prepared = preparePathLayerData({ paths: [path], drawingId: null }, null, null, zoom);
      const stroke = prepared.lineSegments[0];
      if (!stroke) throw new Error("missing range stroke");
      expectAccurate(stroke.path, reference, zoom, "range stroke");
      expect(prepared.vertices).toEqual(path.vertices);
      expect(stroke.pathId).toBe(path.id);
      expect(stroke.sourceIndex).toBe(0);
    }
  });

  it("keeps every freeform stroke edge within half a CSS pixel with one closure", () => {
    const path = layerPath("freeform");
    const references = LEGS.map((leg) => referenceCurve(leg));

    for (const zoom of ZOOMS) {
      const prepared = preparePathLayerData({ paths: [path], drawingId: null }, null, null, zoom);
      const fill = prepared.fills[0];

      if (!fill) throw new Error("missing freeform fill");
      for (const [index, reference] of references.entries()) {
        const stroke = prepared.lineSegments[index];

        if (!stroke) throw new Error("missing freeform stroke");
        expectAccurate(stroke.path, reference, zoom, `freeform stroke ${index}`);
        expect(stroke.pathId).toBe(path.id);
        expect(stroke.sourceIndex).toBe(index);
      }
      expect(fill.pathId).toBe(path.id);
      expect(fill.ring).toEqual([
        ...prepared.lineSegments.flatMap((stroke) => stroke.path.slice(0, -1)),
        A,
      ]);
      expect(fill.ring.filter((point) => point.lat === A.lat && point.lng === A.lng)).toHaveLength(
        2,
      );
      expect(prepared.vertices).toEqual(path.vertices);
    }
  });

  it("keeps the aiming preview within half a CSS pixel across the camera zoom range", () => {
    const reference = referenceCurve(FIRST_LEG);
    for (const zoom of ZOOMS) {
      const options = { preview: { source: A, target: B, label: "100 km" }, zoom };
      const line = createRangeInteractionLayers(options).find(
        (layer) => layer.id === "range-preview-line",
      );
      if (!(line instanceof PathLayer) || !Array.isArray(line.props.data)) {
        throw new Error("missing preview paths");
      }
      const pieces: [number, number][][] = line.props.data;
      const piece = pieces[0];
      if (!piece) throw new Error("missing preview piece");
      expectAccurate(
        piece.map(([lng, lat]) => ({ lng, lat })),
        reference,
        zoom,
        "aiming preview",
      );
    }
  });

  it.each(OUTLINE_KINDS)(
    "keeps the %s preview boundary within half a CSS pixel across the zoom range",
    (kind) => {
      const circleEdge = { lat: 70.03076930882993, lng: 13.067867529959756 };
      const corner = { lat: 70.50033901604002, lng: 15.408231162899193 };
      const fourth = { lat: 69.79873921666885, lng: 13.766452527663175 };
      const positions = kind === "rectangle" ? [A, B, corner] : [A, circleEdge];
      const path = {
        ...layerPath("range"),
        kind,
        rings: kind === "rb-circle" ? 3 : undefined,
        vertices: positions.map((position, sourceIndex) => ({
          pathId: "survey",
          position,
          sourceIndex,
          anchored: false,
          unresolved: false,
        })),
      };
      const references =
        kind === "rectangle"
          ? [
              FIRST_LEG,
              { source: B, target: corner, distanceM: 37000, bearing: 128.53672261739666 },
              {
                source: corner,
                target: fourth,
                distanceM: 99998.32605146703,
                bearing: -140.73336843344856,
              },
              { source: fourth, target: A, distanceM: 37000, bearing: -52.280229355423714 },
            ].map((leg) => referenceCurve(leg))
          : Array.from({ length: kind === "rb-circle" ? 3 : 1 }, (_, ring) =>
              Array.from({ length: 8191 }, (_, index) => {
                const { lat2, lon2 } = Geodesic.WGS84.Direct(
                  A.lat,
                  A.lng,
                  (360 * (index + 0.37)) / 8191,
                  4300 * (ring + 1),
                );
                if (lat2 === undefined || lon2 === undefined)
                  throw new Error("missing reference circle position");
                return project({ lat: lat2, lng: lon2 });
              }),
            );
      for (const zoom of [-2, 0, 5.5, 10, 15.5, 20, 22]) {
        const features = drawingPreviewFeatures({
          data: { paths: [path], drawingId: path.id },
          zoom,
        });
        const outlines = features.filter((feature) => feature.geometry.type === "Polygon");
        for (const [index, reference] of references.entries()) {
          const feature = outlines[kind === "rectangle" ? 0 : index];
          const coordinates =
            feature?.geometry.type === "Polygon" ? feature.geometry.coordinates[0] : undefined;
          if (!coordinates) throw new Error("missing shape outline");
          const boundary = coordinates.map((position) => {
            const [lng, lat] = position;
            if (lng === undefined || lat === undefined)
              throw new Error("missing outline coordinate");
            return { lat, lng };
          });
          expectAccurate(boundary, reference, zoom, `${kind} boundary ${index}`);
          expect(feature?.properties.id).toBe(path.id);
          const centre = reference[3011]!;
          const camera = new WebMercatorViewport({
            longitude: centre.x * 360,
            latitude: (Math.atan(Math.exp(centre.y * 2 * Math.PI)) * 360) / Math.PI - 90,
            zoom,
            width: 1200,
            height: 800,
          });
          const [west, south, east, north] = camera.getBounds();
          const viewport = { west, south, east, north };
          const min = project({ lat: south, lng: west });
          const max = project({ lat: north, lng: east });
          const visibleReference = reference.filter(
            (point) => point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y,
          );
          expect(visibleReference.length).toBeGreaterThan(0);
          const visibleFeatures = drawingPreviewFeatures({
            data: { paths: [path], drawingId: path.id },
            zoom,
            viewport,
          });
          const visibleOutline = visibleFeatures.filter(
            (feature) => feature.geometry.type === "Polygon",
          )[kind === "rectangle" ? 0 : index];
          if (visibleOutline?.geometry.type !== "Polygon")
            throw new Error("missing visible outline");
          const visibleBoundary = visibleOutline.geometry.coordinates[0]!.map((position) => ({
            lng: position[0]!,
            lat: position[1]!,
          }));
          expectAccurate(
            visibleBoundary,
            visibleReference,
            zoom,
            `partially visible ${kind} ${index}`,
          );
        }
      }
    },
    30_000,
  );

  it("reuses subdivision while panning and within a zoom bucket, including anchored trims", () => {
    const path = layerPath("range");
    path.segments = path.segments.map((segment) => ({ ...segment, sourceAnchored: true }));
    path.vertices = path.vertices.map((vertex) => ({
      ...vertex,
      anchored: vertex.sourceIndex === 0,
    }));
    const data = { paths: [path], drawingId: null };
    const viewport = { west: 12.9, east: 13.1, south: 69.9, north: 70.1 };
    preparePathLayerData(data, 20, null, 10.1, viewport);
    const inverse = vi.spyOn(Geodesic.WGS84, "InverseLine");
    try {
      preparePathLayerData(data, 8, { project: () => ({ x: 340, y: 290 }) }, 10.9, viewport);
      expect(
        inverse,
        "panning and fractional zoom must reuse the cached subdivision",
      ).not.toHaveBeenCalled();
      preparePathLayerData(data, 8, null, 11.1, viewport);
      expect(inverse, "crossing a zoom bucket must rebuild subdivision").toHaveBeenCalled();
      inverse.mockClear();
      preparePathLayerData(data, 8, null, 11.1, { ...viewport, west: 14.2, east: 14.4 });
      expect(inverse, "a newly exposed viewport must rebuild subdivision").toHaveBeenCalled();
    } finally {
      inverse.mockRestore();
    }
  });
});
