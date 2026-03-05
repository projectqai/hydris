"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Metric } from "@projectqai/proto/metrics";
import { MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { BarChart3, Box, Cloud, Move3d, Wifi, Wind, Zap } from "lucide-react-native";
import { Text, View } from "react-native";

import { useEntityStore } from "../../store/entity-store";
import type { MetricCategory } from "../../utils/format-metrics";
import {
  formatMetricValue,
  formatRelativeTime,
  getMetricLabel,
  getMetricValue,
  getMetricVisual,
  groupMetricsByCategory,
} from "../../utils/format-metrics";

const CATEGORY_ICONS: Record<MetricCategory, LucideIcon> = {
  environmental: Cloud,
  electrical: Zap,
  spatial: Move3d,
  network: Wifi,
  airQuality: Wind,
  general: Box,
};

export function MetricsSection({ entity }: { entity: Entity }) {
  const t = useThemeColors();
  const liveEntity = useEntityStore((s) => s.entities.get(entity.id));
  const metrics = liveEntity?.metric?.metrics ?? [];

  if (metrics.length === 0) {
    return (
      <View className="items-center justify-center gap-2 px-4 py-8">
        <BarChart3
          size={24}
          strokeWidth={1.5}
          color={t.iconMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text className="text-muted-foreground font-sans text-sm">No metrics available</Text>
      </View>
    );
  }

  const groups = groupMetricsByCategory(metrics);
  const multiGroup = groups.length > 1;

  return (
    <View className="py-2">
      {groups.map((group, gi) => (
        <View key={group.category}>
          {multiGroup && (
            <SectionHeader category={group.category} label={group.label} first={gi === 0} />
          )}
          {group.metrics.map((metric, i) => (
            <MetricRow key={metric.id ?? `${gi}-${i}`} metric={metric} />
          ))}
        </View>
      ))}
    </View>
  );
}

function SectionHeader({
  category,
  label,
  first,
}: {
  category: MetricCategory;
  label: string;
  first: boolean;
}) {
  const t = useThemeColors();
  const Icon = CATEGORY_ICONS[category];

  return (
    <View
      className={cn(
        "flex-row items-center gap-1.5 px-5 pt-3 pb-1",
        !first && "border-foreground/10 border-t",
      )}
    >
      <Icon
        size={12}
        strokeWidth={2}
        color={t.iconSubtle}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text
        accessibilityRole="header"
        className="text-foreground/75 text-11 font-mono tracking-widest uppercase"
      >
        {label}
      </Text>
    </View>
  );
}

function MetricRow({ metric }: { metric: Metric }) {
  const visual = getMetricVisual(metric);

  if (visual === "gauge") return <GaugeRow metric={metric} />;
  return <ValueRow metric={metric} />;
}

function ValueRow({ metric }: { metric: Metric }) {
  return (
    <View
      accessible
      accessibilityLabel={`${getMetricLabel(metric)}: ${formatMetricValue(metric)}${metric.measuredAt ? `, ${formatRelativeTime(metric.measuredAt)}` : ""}`}
      className="flex-row items-baseline justify-between px-5 py-2"
    >
      <Text className="text-foreground/80 flex-1 font-sans text-sm" numberOfLines={1}>
        {getMetricLabel(metric)}
      </Text>
      <View className="flex-row items-baseline gap-2">
        <Text className="text-foreground font-mono text-sm">{formatMetricValue(metric)}</Text>
        {metric.measuredAt && (
          <Text
            className="text-muted-foreground shrink-0 text-right font-mono text-xs"
            numberOfLines={1}
          >
            {formatRelativeTime(metric.measuredAt)}
          </Text>
        )}
      </View>
    </View>
  );
}

function GaugeRow({ metric }: { metric: Metric }) {
  let value = getMetricValue(metric);
  if (metric.unit === MetricUnit.MetricUnitRatio) value *= 100;
  const pct = Math.max(0, Math.min(100, value));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${getMetricLabel(metric)}: ${formatMetricValue(metric)}${metric.measuredAt ? `, ${formatRelativeTime(metric.measuredAt)}` : ""}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      className="gap-1.5 px-5 py-2"
    >
      <View className="flex-row items-baseline justify-between">
        <Text className="text-foreground/80 flex-1 font-sans text-sm" numberOfLines={1}>
          {getMetricLabel(metric)}
        </Text>
        <View className="flex-row items-baseline gap-2">
          <Text className="text-foreground font-mono text-sm">{formatMetricValue(metric)}</Text>
          {metric.measuredAt && (
            <Text
              className="text-muted-foreground shrink-0 text-right font-mono text-xs"
              numberOfLines={1}
            >
              {formatRelativeTime(metric.measuredAt)}
            </Text>
          )}
        </View>
      </View>
      <View className="bg-foreground/20 h-1 overflow-hidden rounded-full">
        <View className="bg-foreground/70 h-1 rounded-full" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}
