import { MetricKind } from "@projectqai/proto/metrics";
import { Leaf } from "lucide-react-native";

import type { MetricCategoryWidgetConfig } from "./metric-category-widget";
import { MetricCategoryWidget } from "./metric-category-widget";

const CONFIG: MetricCategoryWidgetConfig = {
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
  return <MetricCategoryWidget config={CONFIG} />;
}
