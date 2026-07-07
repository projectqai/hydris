import { TileFrame } from "@hydris/ui/tile-frame";
import { MetricKind } from "@projectqai/proto/metrics";
import { Gauge } from "lucide-react-native";

import { MetricTile, type MetricTileConfig } from "./metric-tile";

export const EQUIPMENT_CONFIG: MetricTileConfig = {
  title: "Equipment",
  icon: Gauge,
  categories: ["equipment"],
  heroPriority: [MetricKind.MetricKindHealth, MetricKind.MetricKindFuel, MetricKind.MetricKindAmmo],
  gaugeRanges: {
    [MetricKind.MetricKindHealth]: { min: 0, max: 100 },
    [MetricKind.MetricKindAmmo]: { min: 0, max: 100 },
    [MetricKind.MetricKindFuel]: { min: 0, max: 100 },
  },
};

export function EquipmentWidget() {
  return (
    <TileFrame>
      <MetricTile config={EQUIPMENT_CONFIG} />
    </TileFrame>
  );
}
