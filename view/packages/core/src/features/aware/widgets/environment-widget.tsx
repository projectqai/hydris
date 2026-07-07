import { TileFrame } from "@hydris/ui/tile-frame";
import { MetricKind } from "@projectqai/proto/metrics";
import { Leaf } from "lucide-react-native";

import { MetricTile, type MetricTileConfig } from "./metric-tile";

export const ENVIRONMENT_CONFIG: MetricTileConfig = {
  title: "Environment",
  icon: Leaf,
  categories: ["environmental", "airQuality"],
  supportingPerPage: 2,
  gaugeRanges: {
    [MetricKind.MetricKindCo2]: { min: 0, max: 2500 },
    [MetricKind.MetricKindPm25]: { min: 0, max: 44 },
    [MetricKind.MetricKindPm10]: { min: 0, max: 188 },
    [MetricKind.MetricKindAqi]: { min: 0, max: 126 },
    [MetricKind.MetricKindHumidity]: { min: 5, max: 55, inverted: true },
  },
};

export function EnvironmentWidget() {
  return (
    <TileFrame>
      <MetricTile config={ENVIRONMENT_CONFIG} />
    </TileFrame>
  );
}
