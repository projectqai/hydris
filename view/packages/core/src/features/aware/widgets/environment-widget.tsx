import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Metric } from "@projectqai/proto/metrics";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { LinearGradient } from "expo-linear-gradient";
import { Leaf } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { selectEntity, useEntityStore } from "../store/entity-store";
import { useSelectionStore } from "../store/selection-store";
import {
  formatRelativeTime,
  getMetricCategory,
  getMetricLabel,
  getMetricValue,
  getSharedTimestamp,
  getUnitSymbol,
  type MetricCategory,
} from "../utils/format-metrics";

const ENV_CATEGORIES = new Set<MetricCategory>(["environmental", "airQuality"]);
const SUPPORTING_PER_PAGE = 2;

const REFERENCE_SIZE = 300;

const BASE = {
  padding: 12,
  heroText: 36,
  unitText: 14,
  labelText: 14,
  headerText: 14,
  metaText: 13,
  supportingLabel: 14,
  supportingValue: 15,
  sectionGap: 6,
  rowGap: 6,
  rowPadding: 16,
  gaugeHeight: 5,
  gaugeIndicator: 16,
} as const;

type WidgetScale = { hero: number; body: number; element: number; padding: number };

function computeScale(width: number, height: number): WidgetScale {
  const minDim = Math.min(width, height);
  if (minDim <= 0) return { hero: 1, body: 1, element: 1, padding: 1 };
  const base = minDim / REFERENCE_SIZE;
  return {
    hero: Math.max(0.7, Math.min(1.1, base)),
    body: Math.max(0.7, Math.min(1.0, base * 0.85)),
    element: Math.max(0.7, Math.min(1.05, base * 0.9)),
    padding: Math.max(0.8, Math.min(1.0, base * 0.8)),
  };
}

type HealthLevel = "good" | "moderate" | "poor";

const HEALTH_THRESHOLDS: Partial<
  Record<MetricKind, { moderate: number; poor: number; inverted?: boolean }>
> = {
  [MetricKind.MetricKindCo2]: { moderate: 1000, poor: 2000 },
  [MetricKind.MetricKindPm25]: { moderate: 12, poor: 35 },
  [MetricKind.MetricKindPm10]: { moderate: 50, poor: 150 },
  [MetricKind.MetricKindAqi]: { moderate: 51, poor: 101 },
  [MetricKind.MetricKindHumidity]: { moderate: 30, poor: 20, inverted: true },
};

// Ranges calibrated so moderate threshold → ~40% (yellow) and poor → ~80% (red)
const GAUGE_RANGES: Partial<Record<MetricKind, { min: number; max: number; inverted?: boolean }>> =
  {
    [MetricKind.MetricKindCo2]: { min: 0, max: 2500 },
    [MetricKind.MetricKindPm25]: { min: 0, max: 44 },
    [MetricKind.MetricKindPm10]: { min: 0, max: 188 },
    [MetricKind.MetricKindAqi]: { min: 0, max: 126 },
    [MetricKind.MetricKindHumidity]: { min: 5, max: 55, inverted: true },
  };

function getHealthLevel(metric: Metric): HealthLevel | null {
  if (metric.kind == null) return null;
  const thresholds = HEALTH_THRESHOLDS[metric.kind];
  if (!thresholds) return null;

  const value = getMetricValue(metric);
  if (metric.unit === MetricUnit.MetricUnitRatio) {
    return getHealthFromValue(value * 100, thresholds);
  }
  return getHealthFromValue(value, thresholds);
}

function getHealthFromValue(
  value: number,
  t: { moderate: number; poor: number; inverted?: boolean },
): HealthLevel {
  if (t.inverted) {
    if (value <= t.poor) return "poor";
    if (value <= t.moderate) return "moderate";
    return "good";
  }
  if (value >= t.poor) return "poor";
  if (value >= t.moderate) return "moderate";
  return "good";
}

function getGaugePosition(rawValue: number, kind: MetricKind | undefined): number | null {
  if (kind == null) return null;
  const range = GAUGE_RANGES[kind];
  if (!range) return null;
  const clamped = Math.max(range.min, Math.min(range.max, rawValue));
  const pos = (clamped - range.min) / (range.max - range.min);
  return range.inverted ? 1 - pos : pos;
}

const HEALTH_TEXT: Record<HealthLevel, string> = {
  good: "text-green",
  moderate: "text-yellow",
  poor: "text-red",
};

const HEALTH_DOT: Record<HealthLevel, string> = {
  good: "bg-green",
  moderate: "bg-yellow",
  poor: "bg-red",
};

type MetricDisplay = {
  label: string;
  formattedValue: string;
  unit: string;
  health: HealthLevel | null;
  rawValue: number;
  kind: MetricKind | undefined;
};

function formatValue(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function toDisplay(metric: Metric): MetricDisplay {
  let value = getMetricValue(metric);
  const raw = value;
  if (metric.unit === MetricUnit.MetricUnitRatio) value *= 100;
  return {
    label: getMetricLabel(metric),
    formattedValue: formatValue(value),
    unit: getUnitSymbol(metric.unit),
    health: getHealthLevel(metric),
    rawValue: metric.unit === MetricUnit.MetricUnitRatio ? value : raw,
    kind: metric.kind ?? undefined,
  };
}

const GAUGE_COLORS = ["#22c55e", "#a3e635", "#facc15", "#f97316", "#ef4444"] as const;

function HealthGauge({
  rawValue,
  kind,
  scale,
}: {
  rawValue: number;
  kind: MetricKind | undefined;
  scale: WidgetScale;
}) {
  const position = getGaugePosition(rawValue, kind);
  if (position === null) return null;

  const barHeight = Math.round(BASE.gaugeHeight * scale.element);
  const capWidth = Math.round(10 * scale.element);
  const capHeight = Math.round(BASE.gaugeIndicator * scale.element);

  return (
    <View
      style={{
        height: capHeight,
        justifyContent: "center",
        marginTop: BASE.sectionGap * scale.body,
      }}
    >
      <LinearGradient
        colors={[...GAUGE_COLORS]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: barHeight, borderRadius: barHeight / 2 }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <View style={{ flex: position }} />
        <LinearGradient
          colors={["#3f3f46", "#27272a"]}
          style={{
            width: capWidth,
            height: capHeight,
            borderRadius: 2,
            marginLeft: -capWidth / 2,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.6,
            shadowRadius: 4,
            elevation: 4,
          }}
        >
          <View
            style={{
              width: 1.5,
              height: capHeight * 0.5,
              backgroundColor: "rgba(255,255,255,0.8)",
              borderRadius: 1,
            }}
          />
        </LinearGradient>
      </View>
    </View>
  );
}

export function EnvironmentWidget() {
  const t = useThemeColors();
  const selectedId = useSelectionStore((s) => s.selectedEntityId);
  const entity = useEntityStore(selectEntity(selectedId));
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState<WidgetScale>(() => computeScale(300, 300));

  if (!entity?.metric?.metrics?.length) {
    return (
      <EmptyState
        icon={Leaf}
        title="Environment"
        subtitle={selectedId ? "No metrics available" : "Select an entity"}
      />
    );
  }

  const envMetrics = entity.metric.metrics.filter(
    (m) => m.kind != null && ENV_CATEGORIES.has(getMetricCategory(m)),
  );

  if (envMetrics.length === 0) {
    return <EmptyState icon={Leaf} title="Environment" subtitle="No environmental metrics" />;
  }

  const hero = toDisplay(envMetrics[0]!);
  const supporting = envMetrics.slice(1).map(toDisplay);
  const totalPages = Math.max(1, Math.ceil(supporting.length / SUPPORTING_PER_PAGE));
  const currentPage = supporting.length > 0 ? page % totalPages : 0;
  const pageItems = supporting.slice(
    currentPage * SUPPORTING_PER_PAGE,
    (currentPage + 1) * SUPPORTING_PER_PAGE,
  );

  const timestamp = getSharedTimestamp(envMetrics, { strict: false });

  const padding = Math.round(BASE.padding * scale.padding);
  const heroFontSize = Math.round(BASE.heroText * scale.hero);
  const unitFontSize = Math.round(BASE.unitText * scale.body);
  const labelFontSize = Math.round(BASE.labelText * scale.body);
  const headerFontSize = Math.max(12, Math.round(BASE.headerText * scale.body));
  const metaFontSize = Math.max(10, Math.round(BASE.metaText * scale.body));
  const supportingLabelSize = Math.max(11, Math.round(BASE.supportingLabel * scale.body));
  const supportingValueSize = Math.max(11, Math.round(BASE.supportingValue * scale.body));
  const sectionGap = Math.round(BASE.sectionGap * scale.body);
  const rowGap = Math.round(BASE.rowGap * scale.element);
  const rowPadding = Math.round(BASE.rowPadding * scale.padding);
  const healthDotSize = Math.round(5 * scale.element);

  return (
    <Pressable
      onPress={totalPages > 1 ? () => setPage((p) => p + 1) : undefined}
      className="bg-background flex-1 overflow-hidden select-none"
      style={{ padding }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setScale(computeScale(width, height));
      }}
      accessibilityRole="summary"
      accessibilityLabel={`${hero.label}: ${hero.formattedValue} ${hero.unit}`}
      accessibilityHint={
        totalPages > 1 ? `Page ${currentPage + 1} of ${totalPages}, tap to see more` : undefined
      }
    >
      <View className="flex-row items-center justify-between" style={{ marginBottom: sectionGap }}>
        <Text
          className="font-sans-semibold text-foreground/80 min-w-0 shrink"
          style={{ fontSize: headerFontSize }}
          numberOfLines={1}
        >
          {entity.label ?? entity.id}
        </Text>
        {timestamp && (
          <Text
            className="font-sans-semibold text-foreground/70 ml-3 shrink-0 tabular-nums"
            style={{ fontSize: metaFontSize }}
          >
            {formatRelativeTime(timestamp)}
          </Text>
        )}
      </View>

      <View className="flex-1 justify-center" style={{ gap: sectionGap * 2.5 }}>
        <View className="items-center">
          <View className="flex-row items-start">
            <Text
              className={cn(
                "leading-none tabular-nums",
                Platform.OS === "web" ? "font-sans-semibold" : "font-sans-bold",
                hero.health ? HEALTH_TEXT[hero.health] : "text-foreground",
              )}
              style={{ fontSize: heroFontSize }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {hero.formattedValue}
            </Text>
            {hero.unit ? (
              <Text
                className="text-foreground/60"
                style={{
                  fontSize: unitFontSize,
                  marginLeft: 2,
                  marginTop: heroFontSize * 0.05,
                }}
              >
                {hero.unit}
              </Text>
            ) : null}
          </View>
          <Text
            className="font-sans-semibold text-foreground/80"
            style={{ fontSize: labelFontSize, marginTop: sectionGap * 0.5 }}
          >
            {hero.label}
          </Text>
        </View>
        <HealthGauge rawValue={hero.rawValue} kind={hero.kind} scale={scale} />

        {pageItems.length > 0 && (
          <View style={{ gap: rowGap }}>
            {pageItems.map((item) => (
              <View
                key={item.label}
                className="flex-row items-center justify-between rounded-lg"
                style={{
                  backgroundColor: t.insetBg,
                  borderWidth: 1,
                  borderColor: t.insetBorder,
                  borderBottomColor: t.insetHighlight,
                  paddingHorizontal: rowPadding,
                  paddingVertical: rowPadding * 0.65,
                  boxShadow: t.insetShadow,
                }}
              >
                <Text
                  className="text-foreground/70 shrink"
                  style={{ fontSize: supportingLabelSize }}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                <View className="ml-3 shrink-0 flex-row items-center" style={{ gap: 5 }}>
                  {item.health && (
                    <View
                      className={cn("rounded-full", HEALTH_DOT[item.health])}
                      style={{ width: healthDotSize, height: healthDotSize }}
                    />
                  )}
                  <Text
                    className={cn(
                      "font-sans-medium tabular-nums",
                      item.health ? HEALTH_TEXT[item.health] : "text-foreground",
                    )}
                    style={{ fontSize: supportingValueSize }}
                  >
                    {item.formattedValue}
                    {item.unit ? <Text className="text-foreground/60"> {item.unit}</Text> : null}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {totalPages > 1 && (
        <Text
          className="font-sans-medium text-foreground/60 text-center tabular-nums"
          style={{ fontSize: supportingLabelSize, marginTop: sectionGap }}
        >
          {currentPage + 1} / {totalPages}
        </Text>
      )}
    </Pressable>
  );
}
