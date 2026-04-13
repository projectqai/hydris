import { IconLayer } from "@deck.gl/layers";

import type { ActiveSensorSectors, EntityData } from "../types";
import { DARK_SVG_THEME, getSectorSvgDataUri, LIGHT_SVG_THEME } from "../utils/sensor-svg";

export type SectorRenderData = {
  entity: EntityData;
  sectors: ActiveSensorSectors;
  sectorDataUri: string;
};

type SensorSectorLayerProps = {
  data: SectorRenderData[];
  visible: boolean;
};

export function createSensorSectorLayer({ data, visible }: SensorSectorLayerProps) {
  return new IconLayer<SectorRenderData>({
    id: "sectors",
    data,
    visible: visible && data.length > 0,
    getPosition: (d) => [d.entity.position.lng, d.entity.position.lat],
    getIcon: (d) => ({ url: d.sectorDataUri, width: 230, height: 230, anchorY: 115 }),
    getSize: (d) => (d.entity.ellipseRadius ?? 250) * 2,
    sizeUnits: "meters",
    sizeMaxPixels: 230,
    pickable: false,
  });
}

export function prepareSectorData(
  entity: EntityData,
  colorScheme: "dark" | "light" = "dark",
): SectorRenderData | null {
  if (!entity.ellipseRadius || !entity.activeSectors) return null;
  const theme = colorScheme === "light" ? LIGHT_SVG_THEME : DARK_SVG_THEME;
  return {
    entity,
    sectors: entity.activeSectors,
    sectorDataUri: getSectorSvgDataUri(entity.activeSectors, theme),
  };
}
