import { MetricKind } from "@projectqai/proto/metrics";
import { Gauge } from "lucide-react-native";

import type { MetricCategoryWidgetConfig } from "./metric-category-widget";
import { MetricCategoryWidget } from "./metric-category-widget";

export const EQUIPMENT_CONFIG: MetricCategoryWidgetConfig = {
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
  return <MetricCategoryWidget config={EQUIPMENT_CONFIG} />;
}
