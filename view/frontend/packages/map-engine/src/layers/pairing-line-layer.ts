import { LineLayer } from "@deck.gl/layers";

import { AFFILIATION_COLORS_RGB } from "../constants";
import type { Affiliation, GeoPosition } from "../types";

type PairingLineData = {
  source: GeoPosition;
  target: GeoPosition;
  affiliation: Affiliation;
};

type PairingLineLayerProps = {
  data: PairingLineData | null;
};

export function createPairingLineLayer({ data }: PairingLineLayerProps) {
  if (!data) {
    return new LineLayer<PairingLineData>({
      id: "pairing-line",
      data: [],
      visible: false,
      getSourcePosition: () => [0, 0],
      getTargetPosition: () => [0, 0],
    });
  }

  const color = AFFILIATION_COLORS_RGB[data.affiliation];

  return new LineLayer<PairingLineData>({
    id: "pairing-line",
    data: [data],
    visible: true,
    getSourcePosition: (d) => [d.source.lng, d.source.lat],
    getTargetPosition: (d) => [d.target.lng, d.target.lat],
    getColor: [...color, 180],
    getWidth: 1.5,
    widthUnits: "pixels",
    pickable: false,
  });
}
