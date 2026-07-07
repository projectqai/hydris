import type { Layer } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";

import type { BaseLayer, RGBA } from "../types";

type LabelData = {
  id: string;
  position: [number, number];
  label: string;
  offsetY: number;
  pixelOffset?: [number, number];
};

// deck.gl SDF mispositions some glyphs, so build the halo manually
const STYLES: Record<BaseLayer, { text: RGBA; halo: RGBA }> = {
  dark: { text: [255, 255, 255, 255], halo: [0, 0, 0, 255] },
  satellite: { text: [255, 255, 255, 255], halo: [0, 0, 0, 255] },
  street: { text: [20, 20, 20, 255], halo: [255, 255, 255, 255] },
};

const HALO: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

type LabelInstance = {
  position: [number, number];
  label: string;
  offsetY: number;
  color: RGBA;
  ox: number;
  oy: number;
};

// deck uploads the glyph atlas once per TextLayer, so all halo copies are
// rows in the same layer. text rows come last so they draw on top.
function expand(data: LabelData[], baseLayer: BaseLayer): LabelInstance[] {
  const { text, halo } = STYLES[baseLayer];
  const instances: LabelInstance[] = [];
  const push = (d: LabelData, color: RGBA, dx: number, dy: number) =>
    instances.push({
      position: d.position,
      label: d.label,
      offsetY: d.offsetY,
      color,
      ox: (d.pixelOffset?.[0] ?? 0) + dx,
      oy: (d.pixelOffset?.[1] ?? 0) + dy,
    });
  for (const [dx, dy] of HALO) {
    for (const d of data) push(d, halo, dx, dy);
  }
  for (const d of data) push(d, text, 0, 0);
  return instances;
}

export function createLabelLayer({
  data,
  visible,
  baseLayer = "dark",
}: {
  data: LabelData[];
  visible: boolean;
  baseLayer?: BaseLayer;
}): Layer {
  const show = visible && data.length > 0;
  return new TextLayer<LabelInstance>({
    id: "labels",
    data: show ? expand(data, baseLayer) : [],
    visible: show,
    getPosition: (d) => d.position,
    getText: (d) => d.label,
    getSize: 12,
    getColor: (d) => d.color,
    getTextAnchor: "middle",
    getAlignmentBaseline: "top",
    getPixelOffset: (d) => [d.ox, d.offsetY / 2 + 4 + d.oy],
    fontFamily: "Inter, sans-serif",
    fontWeight: "600",
    fontSettings: { sdf: false, fontSize: 96 },
    characterSet: "auto",
    pickable: false,
  });
}
