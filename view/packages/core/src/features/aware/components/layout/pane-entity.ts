import type { PaneContent } from "@hydris/ui/layout/types";
import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { Video } from "lucide-react-native";

import { getMetricCategory } from "../../utils/format-metrics";
import { ENVIRONMENT_CONFIG } from "../../widgets/environment-widget";
import { EQUIPMENT_CONFIG } from "../../widgets/equipment-widget";
import type { MetricCategoryWidgetConfig } from "../../widgets/metric-category-widget";
import { VITAL_CONFIG } from "../../widgets/vital-widget";

const METRIC_WIDGET_CONFIGS: Record<string, MetricCategoryWidgetConfig> = {
  vitals: VITAL_CONFIG,
  environment: ENVIRONMENT_CONFIG,
  equipment: EQUIPMENT_CONFIG,
};

export type PaneEntityMeta = {
  match: (entity: Entity) => boolean;
  icon: LucideIcon;
  noun: string;
  title: string;
};

function hasMetricInCategories(entity: Entity, cfg: MetricCategoryWidgetConfig): boolean {
  const categories = new Set(cfg.categories);
  return (
    entity.metric?.metrics?.some((m) => m.kind != null && categories.has(getMetricCategory(m))) ??
    false
  );
}

// metric components follow the map selection and can be pinned to a fixed
// entity. camera re-targets its feed.
export function paneEntityMeta(content: PaneContent): PaneEntityMeta | null {
  if (content.type === "component") {
    const cfg = METRIC_WIDGET_CONFIGS[content.componentId];
    if (!cfg) return null;
    const noun = cfg.title.toLowerCase();
    return {
      match: (e) => hasMetricInCategories(e, cfg),
      icon: cfg.icon,
      noun,
      title: `Show ${noun} from`,
    };
  }
  if (content.type === "camera") {
    return {
      match: (e) => (e.camera?.streams?.length ?? 0) > 0,
      icon: Video,
      noun: "cameras",
      title: "Switch camera",
    };
  }
  return null;
}
