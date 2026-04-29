import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Metric } from "@projectqai/proto/metrics";
import { AlertLevel, type MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
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

type HealthLevel = "good" | "moderate" | "poor";
type GaugeRange = { min: number; max: number; inverted?: boolean };

export type MetricCategoryWidgetConfig = {
  title: string;
  icon: LucideIcon;
  categories: MetricCategory[];
  heroPriority?: MetricKind[];
  gaugeRanges?: Partial<Record<MetricKind, GaugeRange>>;
  supportingPerPage?: number;
};

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

function alertToHealth(metric: Metric): HealthLevel | null {
  if (metric.alerting == null || metric.alerting === AlertLevel.AlertLevelNone) return null;
  if (metric.alerting === AlertLevel.AlertLevelWarning) return "moderate";
  return "poor";
}

function getGaugePosition(
  rawValue: number,
  kind: MetricKind | undefined,
  gaugeRanges: Partial<Record<MetricKind, GaugeRange>> | undefined,
): number | null {
  if (!gaugeRanges || kind == null) return null;
  const range = gaugeRanges[kind];
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
    health: alertToHealth(metric),
    rawValue: metric.unit === MetricUnit.MetricUnitRatio ? value : raw,
    kind: metric.kind ?? undefined,
  };
}

function pickHero(
  metrics: Metric[],
  heroPriority: MetricKind[] | undefined,
): { hero: Metric; supporting: Metric[] } {
  if (heroPriority) {
    for (const kind of heroPriority) {
      const idx = metrics.findIndex((m) => m.kind === kind);
      if (idx !== -1) {
        const hero = metrics[idx]!;
        const supporting = [...metrics.slice(0, idx), ...metrics.slice(idx + 1)];
        return { hero, supporting };
      }
    }
  }
  return { hero: metrics[0]!, supporting: metrics.slice(1) };
}

const GAUGE_COLORS = ["#22c55e", "#a3e635", "#facc15", "#f97316", "#ef4444"] as const;

function HealthGauge({
  rawValue,
  kind,
  scale,
  gaugeRanges,
}: {
  rawValue: number;
  kind: MetricKind | undefined;
  scale: WidgetScale;
  gaugeRanges: Partial<Record<MetricKind, GaugeRange>> | undefined;
}) {
  const position = getGaugePosition(rawValue, kind, gaugeRanges);
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

export function MetricCategoryWidget({ config }: { config: MetricCategoryWidgetConfig }) {
  const t = useThemeColors();
  const selectedId = useSelectionStore((s) => s.selectedEntityId);
  const entity = useEntityStore(selectEntity(selectedId));
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState<WidgetScale>(() => computeScale(300, 300));

  const categorySet = new Set(config.categories);
  const supportingPerPage = config.supportingPerPage ?? Infinity;

  if (!entity?.metric?.metrics?.length) {
    return (
      <EmptyState
        icon={config.icon}
        title={config.title}
        subtitle={selectedId ? "No metrics available" : "Select an entity"}
      />
    );
  }

  const filtered = entity.metric.metrics.filter(
    (m) => m.kind != null && categorySet.has(getMetricCategory(m)),
  );

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={config.icon}
        title={config.title}
        subtitle={`No ${config.title.toLowerCase()} metrics`}
      />
    );
  }

  const { hero: heroMetric, supporting } = pickHero(filtered, config.heroPriority);
  const hero = toDisplay(heroMetric);
  const allSupporting = supporting.map(toDisplay);

  const totalPages = Math.max(1, Math.ceil(allSupporting.length / supportingPerPage));
  const currentPage = allSupporting.length > 0 ? page % totalPages : 0;
  const pageItems =
    supportingPerPage === Infinity
      ? allSupporting
      : allSupporting.slice(currentPage * supportingPerPage, (currentPage + 1) * supportingPerPage);

  const timestamp = getSharedTimestamp(filtered, { strict: false });
  const paginated = totalPages > 1;

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

  const Wrapper = paginated ? Pressable : View;
  const wrapperProps = paginated
    ? {
        onPress: () => setPage((p) => p + 1),
        accessibilityHint: `Page ${currentPage + 1} of ${totalPages}, tap to see more`,
      }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className="bg-background flex-1 overflow-hidden select-none"
      style={{ padding }}
      onLayout={(e: { nativeEvent: { layout: { width: number; height: number } } }) => {
        const { width, height } = e.nativeEvent.layout;
        setScale(computeScale(width, height));
      }}
      accessibilityRole="summary"
      accessibilityLabel={`${hero.label}: ${hero.formattedValue} ${hero.unit}`}
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
        <HealthGauge
          rawValue={hero.rawValue}
          kind={hero.kind}
          scale={scale}
          gaugeRanges={config.gaugeRanges}
        />

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

      {paginated && (
        <Text
          className="font-sans-medium text-foreground/60 text-center tabular-nums"
          style={{ fontSize: supportingLabelSize, marginTop: sectionGap }}
        >
          {currentPage + 1} / {totalPages}
        </Text>
      )}
    </Wrapper>
  );
}
