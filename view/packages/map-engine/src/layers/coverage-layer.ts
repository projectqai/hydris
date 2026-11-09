import { GeoJsonLayer } from "@deck.gl/layers";

import { AFFILIATION_COLORS_RGB } from "../constants";
import type { Affiliation, BaseLayer, RGBA, ShapeFeature, ShapeProperties } from "../types";
import { CASED_LINE_WIDTH, LINE_WIDTH, pathCasingColor } from "./path-layer";

function withAlpha(alpha: number): Record<Affiliation, RGBA> {
  return Object.fromEntries(
    Object.entries(AFFILIATION_COLORS_RGB).map(([aff, [r, g, b]]) => [
      aff,
      [r, g, b, alpha] as RGBA,
    ]),
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
  const layerVisible = visible && data.length > 0;
  return [
    new GeoJsonLayer<ShapeProperties>({
      id: "coverage-fill",
      data,
      visible: layerVisible,
      filled: true,
      stroked: false,
      getFillColor: (f) => fill[f.properties.affiliation],
      pickable: false,
    }),
    new GeoJsonLayer<ShapeProperties>({
      id: "coverage-casing",
      data,
      visible: layerVisible,
      filled: false,
      stroked: true,
      getLineColor: pathCasingColor(baseLayer),
      getLineWidth: CASED_LINE_WIDTH,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: CASED_LINE_WIDTH,
      lineJointRounded: true,
      lineCapRounded: true,
      pickable: false,
    }),
    new GeoJsonLayer<ShapeProperties>({
      id: "coverage",
      data,
      visible: layerVisible,
      filled: false,
      stroked: true,
      getLineColor: (f) => stroke[f.properties.affiliation],
      getLineWidth: LINE_WIDTH,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: LINE_WIDTH,
      lineJointRounded: true,
      lineCapRounded: true,
      pickable: false,
    }),
  ];
}
