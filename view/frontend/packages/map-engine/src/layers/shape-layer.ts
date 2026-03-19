import type { PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { GeoJsonLayer } from "@deck.gl/layers";

import type { ShapeFeature, ShapeLineStyle, ShapeProperties } from "../types";

const DASH_ARRAYS: Record<ShapeLineStyle, [number, number]> = {
  solid: [0, 0],
  dashed: [8, 4],
  dotted: [2, 4],
};

const dashExtension = new PathStyleExtension({ dash: true });

type ShapeLayerProps = {
  data: ShapeFeature[];
  visible: boolean;
  selectedId: string | null;
  onClick?: (id: string) => void | Promise<void>;
};

export function createShapeLayer({ data, visible, selectedId, onClick }: ShapeLayerProps) {
  return new GeoJsonLayer<ShapeProperties>({
    id: "shapes",
    data,
    visible: visible && data.length > 0,
    stroked: true,
    filled: false,
    getLineColor: (f) => [...f.properties.color, 255] as [number, number, number, number],
    getLineWidth: (f) => (f.properties.id === selectedId ? 3 : 2),
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 2,
    pointRadiusMinPixels: 8,
    pickable: true,
    extensions: [dashExtension],
    // @ts-expect-error getDashArray is provided by PathStyleExtension
    getDashArray: (f: ShapeFeature) => DASH_ARRAYS[f.properties.lineStyle ?? "solid"],
    dashJustified: true,
    onClick: (info: PickingInfo): boolean => {
      if (info.object) {
        const id = (info.object as ShapeFeature).properties?.id;
        if (id) {
          onClick?.(id);
          return true;
        }
      }
      return false;
    },
  });
}
