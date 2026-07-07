import { TileFrame } from "@hydris/ui/tile-frame";
import { MetricKind } from "@projectqai/proto/metrics";
import { HeartPulse } from "lucide-react-native";

import { MetricTile, type MetricTileConfig } from "./metric-tile";

export const VITAL_CONFIG: MetricTileConfig = {
  title: "Vitals",
  icon: HeartPulse,
  categories: ["vital"],
  heroPriority: [
    MetricKind.MetricKindHeartRate,
    MetricKind.MetricKindOxygenSaturation,
    MetricKind.MetricKindBodyTemperature,
  ],
  gaugeRanges: {
    [MetricKind.MetricKindHeartRate]: { min: 40, max: 190 },
    [MetricKind.MetricKindOxygenSaturation]: { min: 70, max: 100, inverted: true },
    [MetricKind.MetricKindBodyTemperature]: { min: 35, max: 42 },
  },
};

export function VitalWidget() {
  return (
    <TileFrame>
      <MetricTile config={VITAL_CONFIG} />
    </TileFrame>
  );
}
