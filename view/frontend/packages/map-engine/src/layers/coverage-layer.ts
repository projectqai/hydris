import { GeoJsonLayer } from "@deck.gl/layers";

import type { Affiliation, BaseLayer, ShapeFeature, ShapeProperties } from "../types";

type RGBA = [number, number, number, number];

const FILL_DARK: Record<Affiliation, RGBA> = {
  blue: [59, 130, 246, 40],
  red: [205, 24, 24, 40],
  neutral: [61, 141, 122, 40],
  unknown: [247, 239, 129, 40],
};

const STROKE_DARK: Record<Affiliation, RGBA> = {
  blue: [59, 130, 246, 120],
  red: [205, 24, 24, 120],
  neutral: [61, 141, 122, 120],
  unknown: [247, 239, 129, 120],
};

const FILL_SAT: Record<Affiliation, RGBA> = {
  blue: [59, 130, 246, 80],
  red: [205, 24, 24, 80],
  neutral: [61, 141, 122, 80],
  unknown: [247, 239, 129, 80],
};

const STROKE_SAT: Record<Affiliation, RGBA> = {
  blue: [59, 130, 246, 180],
  red: [205, 24, 24, 180],
  neutral: [61, 141, 122, 180],
  unknown: [247, 239, 129, 180],
};

type CoverageLayerProps = {
  data: ShapeFeature[];
  visible: boolean;
  baseLayer?: BaseLayer;
};

export function createCoverageLayer({ data, visible, baseLayer = "dark" }: CoverageLayerProps) {
  const isSatellite = baseLayer === "satellite";
  const fill = isSatellite ? FILL_SAT : FILL_DARK;
  const stroke = isSatellite ? STROKE_SAT : STROKE_DARK;
  return new GeoJsonLayer<ShapeProperties>({
    id: "coverage",
    data,
    visible: visible && data.length > 0,
    filled: true,
    stroked: true,
    getFillColor: (f) => fill[f.properties.affiliation],
    getLineColor: (f) => stroke[f.properties.affiliation],
    lineWidthMinPixels: isSatellite ? 2 : 1,
    pickable: false,
  });
}
