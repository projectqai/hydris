import type { PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { GeoJsonLayer } from "@deck.gl/layers";

import type { BaseLayer, RGBA, ShapeFeature, ShapeLineStyle, ShapeProperties } from "../types";
import {
  CASED_LINE_WIDTH,
  LINE_WIDTH,
  pathCasingColor,
  SELECTED_CASED_LINE_WIDTH,
  SELECTED_LINE_WIDTH,
} from "./path-layer";

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
  // returns whether the click was used, so a tool that is placing can refuse
  // it and let the point land
  onClick?: (id: string) => boolean;
  drawnColor: RGBA;
  fillColor?: RGBA;
  filled?: boolean;
  baseLayer?: BaseLayer;
  id?: string;
  // a preview is not a thing you can select, and picking it would swallow the
  // clicks and hovers that are still placing it
  pickable?: boolean;
};

export function createShapeLayer({
  data,
  visible,
  selectedId,
  onClick,
  drawnColor,
  fillColor = [0, 0, 0, 0],
  filled = true,
  baseLayer = "satellite",
  id = "shapes",
  pickable = true,
}: ShapeLayerProps): GeoJsonLayer<ShapeProperties>[] {
  const casingColor = pathCasingColor(baseLayer);
  const createLayer = (
    layerData: ShapeFeature[],
    layerFilled: boolean,
    layerStroked: boolean,
    layerId: string,
    casing = false,
  ) =>
    new GeoJsonLayer<ShapeProperties>({
      id: layerId,
      data: layerData,
      // Partitioning retains feature objects, so a new array need not rebuild geometry.
      dataComparator: (next, previous) =>
        Array.isArray(next) &&
        Array.isArray(previous) &&
        next.length === previous.length &&
        next.every((feature, index) => feature === previous[index]),
      updateTriggers: { getLineWidth: selectedId, getLineColor: drawnColor },
      visible: visible && layerData.length > 0,
      stroked: layerStroked,
      filled: layerFilled,
      getFillColor: fillColor,
      getLineColor: casing
        ? casingColor
        : (f) => (f.properties.drawn ? drawnColor : ([...f.properties.color, 255] as RGBA)),
      getLineWidth: (f) =>
        f.properties.id === selectedId
          ? casing
            ? SELECTED_CASED_LINE_WIDTH
            : SELECTED_LINE_WIDTH
          : casing
            ? CASED_LINE_WIDTH
            : LINE_WIDTH,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: casing ? CASED_LINE_WIDTH : LINE_WIDTH,
      lineJointRounded: true,
      lineCapRounded: true,
      pointRadiusMinPixels: 8,
      pickable: pickable && !casing,
      extensions: [dashExtension],
      // @ts-expect-error getDashArray is provided by PathStyleExtension
      getDashArray: (f: ShapeFeature) => DASH_ARRAYS[f.properties.lineStyle ?? "solid"],
      dashJustified: true,
      onClick: (info: PickingInfo): boolean => {
        const shapeId = info.object ? (info.object as ShapeFeature).properties?.id : undefined;
        return shapeId ? (onClick?.(shapeId) ?? false) : false;
      },
    });

  if (!filled) {
    const outlines = data.filter((feature) => !feature.properties.fillOnly);
    return [
      createLayer(outlines, false, true, `${id}-casing`, true),
      createLayer(outlines, false, true, id),
    ];
  }

  const drawnShapes = data.filter(
    (feature) =>
      feature.properties.drawn &&
      !feature.properties.collectionMember &&
      feature.geometry.type === "Polygon",
  );
  const drawnCollection = data.filter(
    (feature) => feature.properties.drawn && feature.properties.collectionMember,
  );
  const otherShapes = data.filter((feature) => !feature.properties.drawn);

  const drawnLines = data.filter(
    (feature) =>
      feature.properties.drawn &&
      !feature.properties.collectionMember &&
      feature.geometry.type !== "Polygon",
  );
  const outlines = [...drawnShapes, ...drawnLines, ...drawnCollection, ...otherShapes].filter(
    (feature) => !feature.properties.fillOnly,
  );
  return [
    createLayer(drawnShapes, true, false, `${id}-drawn-fill`),
    createLayer(outlines, false, true, `${id}-casing`, true),
    createLayer(outlines, false, true, id),
  ];
}
