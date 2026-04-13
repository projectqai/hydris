import { GeoJsonLayer } from "@deck.gl/layers";

import { AFFILIATION_COLORS_RGB } from "../constants";
import type { Affiliation, BaseLayer, ShapeFeature, ShapeProperties } from "../types";

type RGBA = [number, number, number, number];

function withAlpha(alpha: number): Record<Affiliation, RGBA> {
  return Object.fromEntries(
    Object.entries(AFFILIATION_COLORS_RGB).map(([k, [r, g, b]]) => [k, [r, g, b, alpha]]),
  ) as Record<Affiliation, RGBA>;
}

const FILL_DARK = withAlpha(40);
const STROKE_DARK = withAlpha(120);
const FILL_SAT = withAlpha(80);
const STROKE_SAT = withAlpha(180);

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
