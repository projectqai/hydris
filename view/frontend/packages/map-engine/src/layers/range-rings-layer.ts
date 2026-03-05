import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Feature, LineString, Polygon } from "geojson";

import type { BaseLayer, GeoPosition } from "../types";
import { circleToPolygon } from "../utils/geodesic-circle";

const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;
const CIRCLE_SEGMENTS = 128;
const SPOKE_BEARINGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

type RGBA = [number, number, number, number];

type ColorTheme = {
  ring: RGBA;
  spoke: RGBA;
  label: RGBA;
  labelOutline: RGBA;
  center: RGBA;
};

const THEME_SATELLITE: ColorTheme = {
  ring: [255, 255, 255, 160],
  spoke: [255, 255, 255, 120],
  label: [255, 255, 255, 240],
  labelOutline: [0, 0, 0, 200],
  center: [80, 220, 60, 255],
};

const THEME_DARK: ColorTheme = {
  ring: [80, 140, 255, 160],
  spoke: [80, 140, 255, 120],
  label: [80, 140, 255, 240],
  labelOutline: [0, 0, 0, 200],
  center: [80, 220, 60, 255],
};

const THEME_STREET: ColorTheme = {
  ring: [40, 70, 180, 160],
  spoke: [40, 70, 180, 120],
  label: [40, 70, 180, 240],
  labelOutline: [255, 255, 255, 180],
  center: [80, 220, 60, 255],
};

const THEMES: Record<BaseLayer, ColorTheme> = {
  satellite: THEME_SATELLITE,
  dark: THEME_DARK,
  street: THEME_STREET,
};

type RingFeature = Feature<Polygon, { distance: number }>;
type SpokeFeature = Feature<LineString, { bearing: number }>;
type LabelData = { position: [number, number]; text: string };

function destination(origin: GeoPosition, bearingDeg: number, distanceM: number): GeoPosition {
  const angDist = distanceM / EARTH_RADIUS;
  const lat1 = origin.lat * DEG;
  const lng1 = origin.lng * DEG;
  const br = bearingDeg * DEG;
  const sinAng = Math.sin(angDist);
  const cosAng = Math.cos(angDist);
  const sinLat = Math.sin(lat1);
  const cosLat = Math.cos(lat1);
  const lat2 = Math.asin(sinLat * cosAng + cosLat * sinAng * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * sinAng * cosLat, cosAng - sinLat * Math.sin(lat2));
  return { lat: lat2 / DEG, lng: lng2 / DEG };
}

// Use a single unit for all labels in a ring set based on the interval
function formatDistance(meters: number, useKm: boolean): string {
  if (useKm) return `${meters / 1_000} km`;
  return `${meters} m`;
}

function buildRingFeature(center: GeoPosition, radiusM: number): RingFeature {
  const shape = circleToPolygon(center, radiusM, undefined, CIRCLE_SEGMENTS);
  if (shape.type !== "polygon") throw new Error("Expected polygon");
  const coords = shape.outer.map((p) => [p.lng, p.lat] as [number, number]);
  if (coords.length > 0 && coords[0]) coords.push(coords[0]);
  return {
    type: "Feature",
    properties: { distance: radiusM },
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

function buildSpokeFeature(
  center: GeoPosition,
  bearingDeg: number,
  maxRadiusM: number,
): SpokeFeature {
  const end = destination(center, bearingDeg, maxRadiusM);
  return {
    type: "Feature",
    properties: { bearing: bearingDeg },
    geometry: {
      type: "LineString",
      coordinates: [
        [center.lng, center.lat],
        [end.lng, end.lat],
      ],
    },
  };
}

type RangeRingsLayerProps = {
  center: GeoPosition;
  scaleBarDistanceM: number;
  metersPerPx: number;
  viewportWidth: number;
  viewportHeight: number;
  baseLayer?: BaseLayer;
};

export function createRangeRingsLayers({
  center,
  scaleBarDistanceM,
  metersPerPx,
  viewportWidth,
  viewportHeight,
  baseLayer = "satellite",
}: RangeRingsLayerProps) {
  const intervalM = scaleBarDistanceM;
  const maxRadiusPx = Math.hypot(viewportWidth, viewportHeight) / 2;
  const maxRadiusM = maxRadiusPx * metersPerPx;
  const ringCount = Math.max(1, Math.floor(maxRadiusM / intervalM));
  const outerRadiusM = intervalM * ringCount;
  const useKm = intervalM >= 1_000;
  const theme = THEMES[baseLayer];

  const ringFeatures: RingFeature[] = [];
  const distanceLabels: LabelData[] = [];

  for (let i = 1; i <= ringCount; i++) {
    const radiusM = intervalM * i;
    ringFeatures.push(buildRingFeature(center, radiusM));

    const pos = destination(center, 0, radiusM);
    distanceLabels.push({
      position: [pos.lng, pos.lat],
      text: formatDistance(radiusM, useKm),
    });
  }

  const spokeFeatures: SpokeFeature[] = SPOKE_BEARINGS.map((b) =>
    buildSpokeFeature(center, b, outerRadiusM),
  );

  const bearingLabels: LabelData[] = SPOKE_BEARINGS.map((b) => {
    const pos = destination(center, b, outerRadiusM * 1.04);
    return { position: [pos.lng, pos.lat], text: `${b}` };
  });

  const ringsLayer = new GeoJsonLayer<{ distance: number }>({
    id: "range-rings",
    data: ringFeatures,
    stroked: true,
    filled: false,
    getLineColor: theme.ring,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    getLineWidth: 1,
    pickable: false,
  });

  const spokesLayer = new GeoJsonLayer<{ bearing: number }>({
    id: "range-ring-spokes",
    data: spokeFeatures,
    stroked: true,
    filled: false,
    getLineColor: theme.spoke,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    getLineWidth: 1,
    pickable: false,
  });

  const distLabelsLayer = new TextLayer<LabelData>({
    id: "range-ring-dist-labels",
    data: distanceLabels,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getSize: 11,
    getColor: theme.label,
    getTextAnchor: "start",
    getAlignmentBaseline: "bottom",
    getPixelOffset: [4, -2],
    fontFamily: "Inter, sans-serif",
    fontWeight: "normal",
    fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
    outlineWidth: 2,
    outlineColor: theme.labelOutline,
    pickable: false,
  });

  const bearingLabelsLayer = new TextLayer<LabelData>({
    id: "range-ring-bearing-labels",
    data: bearingLabels,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getSize: 12,
    getColor: theme.label,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    fontFamily: "Inter, sans-serif",
    fontWeight: "normal",
    fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
    outlineWidth: 2,
    outlineColor: theme.labelOutline,
    pickable: false,
  });

  const centerLayer = new ScatterplotLayer({
    id: "range-ring-center",
    data: [{ position: [center.lng, center.lat] }],
    getPosition: (d: { position: [number, number] }) => d.position,
    getRadius: 5,
    radiusUnits: "pixels",
    getFillColor: theme.center,
    pickable: false,
  });

  return {
    layers: [ringsLayer, spokesLayer, distLabelsLayer, bearingLabelsLayer],
    centerLayer,
  };
}
