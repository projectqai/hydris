import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { headerIconSize, useMeasuredScale, type WidgetScale } from "@hydris/ui/lib/widget-scale";
import type { Metric } from "@projectqai/proto/metrics";
import { AlertLevel, type MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react-native";
import { type ReactNode, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Directions, Gesture, GestureDetector } from "react-native-gesture-handler";

import { PinButton } from "../components/layout/pane-pin-button";
import { usePaneEntity } from "../pane-entity-context";
import { selectEntity, useEntityStore } from "../store/entity-store";
import { useSelectionStore } from "../store/selection-store";
import {
  formatRelativeTime,
  getMetricCategory,
  getMetricLabel,
  getMetricValue,
  getSharedTimestamp,
  getUnitSymbol,
  hasDisplayFloor,
  type MetricCategory,
  scaleForDisplay,
} from "../utils/format-metrics";

type HealthLevel = "good" | "moderate" | "poor";
type GaugeRange = { min: number; max: number; inverted?: boolean };

export type MetricCategoryWidgetConfig = {
  title: string;
  icon: LucideIcon;
  categories: MetricCategory[];
  // Hero selection. heroIds wins if any metric matches; falls back to heroPriority by kind.
  heroIds?: ReadonlySet<number>;
  heroPriority?: MetricKind[];
  gaugeRanges?: Partial<Record<MetricKind, GaugeRange>>;
  supportingPerPage?: number;
};

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

function formatValue(value: number, maxDecimals = 1): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

function toDisplay(metric: Metric): MetricDisplay {
  const raw = getMetricValue(metric);
  const { value, unit } = scaleForDisplay(raw, metric.unit);
  return {
    label: getMetricLabel(metric),
    formattedValue: formatValue(value, hasDisplayFloor(unit) ? 2 : 1),
    unit: getUnitSymbol(unit),
    health: alertToHealth(metric),
    rawValue: metric.unit === MetricUnit.MetricUnitRatio ? value : raw,
    kind: metric.kind ?? undefined,
  };
}

function pickHero(
  metrics: Metric[],
  heroIds: ReadonlySet<number> | undefined,
  heroPriority: MetricKind[] | undefined,
): { hero: Metric; supporting: Metric[] } {
  const takeAt = (idx: number) => {
    const hero = metrics[idx]!;
    const supporting = [...metrics.slice(0, idx), ...metrics.slice(idx + 1)];
    return { hero, supporting };
  };
  if (heroIds) {
    const idx = metrics.findIndex((m) => m.id != null && heroIds.has(m.id));
    if (idx !== -1) return takeAt(idx);
  }
  if (heroPriority) {
    for (const kind of heroPriority) {
      const idx = metrics.findIndex((m) => m.kind === kind);
      if (idx !== -1) return takeAt(idx);
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

type MetricCategoryWidgetProps = {
  config: MetricCategoryWidgetConfig;
  // Override the selected entity. When set, the widget renders metrics from
  // this entity instead of the globally-selected one.
  entityId?: string;
  // When false, the entity-label header row is suppressed (the surrounding
  // container is expected to provide its own framing, e.g. SensorWidgetShell).
  showHeader?: boolean;
};

// An unbound widget renders the empty state, so the pin lives here too.
function EmptyWithPin({
  pinned,
  onPin,
  size,
  padding,
  onLayout,
  children,
}: {
  pinned: boolean;
  onPin?: () => void;
  size: number;
  padding: number;
  onLayout?: (e: { nativeEvent: { layout: { width: number; height: number } } }) => void;
  children: ReactNode;
}) {
  if (!onPin) return <>{children}</>;
  return (
    <View onLayout={onLayout} style={{ flex: 1, padding }}>
      <View className="flex-row justify-end">
        <PinButton pinned={pinned} onPress={onPin} size={size} />
      </View>
      <View className="flex-1">{children}</View>
    </View>
  );
}

function PageArrow({
  direction,
  onPress,
  size,
}: {
  direction: "prev" | "next";
  onPress: () => void;
  size: number;
}) {
  const t = useThemeColors();
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      onPress={onPress}
      aria-label={direction === "prev" ? "Previous page" : "Next page"}
      hitSlop={
        direction === "prev"
          ? { top: 8, bottom: 8, left: 16, right: 12 }
          : { top: 8, bottom: 8, left: 12, right: 16 }
      }
      className="hover:bg-glass-hover active:bg-surface-overlay/12 rounded p-3"
    >
      <Icon aria-hidden size={size} strokeWidth={2} color={t.iconMuted} />
    </Pressable>
  );
}

export function MetricCategoryWidget({
  config,
  entityId,
  showHeader = true,
}: MetricCategoryWidgetProps) {
  const t = useThemeColors();
  const selectedId = useSelectionStore((s) => s.selectedEntityId);
  const { entityId: paneEntityId, onPin } = usePaneEntity();
  const effectiveId = entityId ?? paneEntityId ?? selectedId;
  const entity = useEntityStore(selectEntity(effectiveId));
  const [page, setPage] = useState(0);
  const { scale, onLayout } = useMeasuredScale();
  const swipe = useMemo(
    () =>
      Gesture.Race(
        Gesture.Fling()
          .direction(Directions.LEFT)
          .runOnJS(true)
          .onEnd(() => setPage((p) => p + 1)),
        Gesture.Fling()
          .direction(Directions.RIGHT)
          .runOnJS(true)
          .onEnd(() => setPage((p) => p - 1)),
      ),
    [],
  );

  const categorySet = new Set(config.categories);
  const supportingPerPage = config.supportingPerPage ?? Infinity;
  const padding = Math.round(BASE.padding * scale.padding);
  const headerFontSize = Math.max(12, Math.round(BASE.headerText * scale.body));
  const pinSize = headerIconSize(scale);

  if (!entity?.metric?.metrics?.length) {
    return (
      <EmptyWithPin
        pinned={!!paneEntityId}
        onPin={showHeader ? onPin : undefined}
        size={pinSize}
        padding={padding}
        onLayout={onLayout}
      >
        <EmptyState
          icon={config.icon}
          title={config.title}
          subtitle={effectiveId ? "No metrics available" : "Select an entity"}
        />
      </EmptyWithPin>
    );
  }

  const filtered = entity.metric.metrics.filter(
    (m) => m.kind != null && categorySet.has(getMetricCategory(m)),
  );

  if (filtered.length === 0) {
    return (
      <EmptyWithPin
        pinned={!!paneEntityId}
        onPin={showHeader ? onPin : undefined}
        size={pinSize}
        padding={padding}
        onLayout={onLayout}
      >
        <EmptyState
          icon={config.icon}
          title={config.title}
          subtitle={`No ${config.title.toLowerCase()} metrics`}
        />
      </EmptyWithPin>
    );
  }

  const { hero: heroMetric, supporting } = pickHero(filtered, config.heroIds, config.heroPriority);
  const hero = toDisplay(heroMetric);
  const allSupporting = supporting.map(toDisplay);

  const totalPages = Math.max(1, Math.ceil(allSupporting.length / supportingPerPage));
  const currentPage =
    allSupporting.length > 0 ? ((page % totalPages) + totalPages) % totalPages : 0;
  const pageItems =
    supportingPerPage === Infinity
      ? allSupporting
      : allSupporting.slice(currentPage * supportingPerPage, (currentPage + 1) * supportingPerPage);

  const timestamp = getSharedTimestamp(filtered, { strict: false });
  const paginated = totalPages > 1;

  const heroFontSize = Math.round(BASE.heroText * scale.hero);
  const unitFontSize = Math.round(BASE.unitText * scale.body);
  const labelFontSize = Math.round(BASE.labelText * scale.body);
  const metaFontSize = Math.max(10, Math.round(BASE.metaText * scale.body));
  const supportingLabelSize = Math.max(11, Math.round(BASE.supportingLabel * scale.body));
  const supportingValueSize = Math.max(11, Math.round(BASE.supportingValue * scale.body));
  const sectionGap = Math.round(BASE.sectionGap * scale.body);
  const rowGap = Math.round(BASE.rowGap * scale.element);
  const rowPadding = Math.round(BASE.rowPadding * scale.padding);
  const healthDotSize = Math.round(5 * scale.element);

  const body = (
    <View
      className={cn("flex-1 overflow-hidden select-none", showHeader ? "bg-background" : "")}
      style={{ padding }}
      onLayout={onLayout}
      accessibilityRole="summary"
      accessibilityLabel={`${hero.label}: ${hero.formattedValue} ${hero.unit}`}
    >
      {showHeader && (
        <View
          className="flex-row items-center justify-between"
          style={{ marginBottom: sectionGap }}
        >
          <Text
            className="font-sans-semibold text-foreground/80 min-w-0 shrink"
            style={{ fontSize: headerFontSize }}
            numberOfLines={1}
          >
            {entity.label ?? entity.id}
          </Text>
          <View className="ml-3 shrink-0 flex-row items-center" style={{ gap: 8 * scale.body }}>
            {timestamp && (
              <Text
                className="font-sans-semibold text-foreground/70 tabular-nums"
                style={{ fontSize: metaFontSize }}
              >
                {formatRelativeTime(timestamp)}
              </Text>
            )}
            {onPin && <PinButton pinned={!!paneEntityId} onPress={onPin} size={pinSize} />}
          </View>
        </View>
      )}

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
        <View className="flex-row items-center justify-between" style={{ marginTop: sectionGap }}>
          <PageArrow direction="prev" size={pinSize} onPress={() => setPage((p) => p - 1)} />
          <Text
            className="font-sans-medium text-foreground/60 text-center tabular-nums"
            style={{ fontSize: supportingLabelSize }}
          >
            {currentPage + 1} / {totalPages}
          </Text>
          <PageArrow direction="next" size={pinSize} onPress={() => setPage((p) => p + 1)} />
        </View>
      )}
    </View>
  );

  return paginated ? <GestureDetector gesture={swipe}>{body}</GestureDetector> : body;
}
