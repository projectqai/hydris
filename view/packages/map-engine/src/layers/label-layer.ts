import { TextLayer } from "@deck.gl/layers";

import type { BaseLayer } from "../types";

type LabelData = {
  id: string;
  position: [number, number];
  label: string;
  offsetY: number;
  pixelOffset?: [number, number];
};

type Color = [number, number, number, number];

type LabelStyle = {
  text: Color;
  outline: Color;
  width: number;
};

const LABEL_STYLES = {
  dark: { text: [255, 255, 255, 255], outline: [0, 0, 0, 255], width: 2 },
  satellite: { text: [255, 255, 255, 255], outline: [20, 20, 20, 200], width: 2 },
  street: { text: [20, 20, 20, 255], outline: [255, 255, 255, 255], width: 3 },
} satisfies Record<BaseLayer, LabelStyle>;

type LabelLayerProps = {
  data: LabelData[];
  visible: boolean;
  baseLayer?: BaseLayer;
};

export function createLabelLayer({ data, visible, baseLayer = "dark" }: LabelLayerProps) {
  const config = LABEL_STYLES[baseLayer];

  return new TextLayer<LabelData>({
    id: "labels",
    data,
    visible: visible && data.length > 0,
    getPosition: (d) => d.position,
    getText: (d) => d.label,
    getSize: 12,
    getColor: config.text,
    getTextAnchor: "middle",
    getAlignmentBaseline: "top",
    getPixelOffset: (d) => [d.pixelOffset?.[0] ?? 0, d.offsetY / 2 + 4 + (d.pixelOffset?.[1] ?? 0)],
    fontFamily: "Inter, sans-serif",
    fontWeight: "normal",
    fontSettings: { sdf: true, buffer: 8, cutoff: 0.15 },
    outlineWidth: config.width,
    outlineColor: config.outline,
    pickable: false,
  });
}
