import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { chooseTileFit, type TileGeometry, useTileMeasure } from "@hydris/ui/lib/tile-layout";
import { cn } from "@hydris/ui/lib/utils";
import { useIsScreenLocked } from "@hydris/ui/screen-lock";
import { TileHeader, type TileHeaderContent, type TileHeaderSizes } from "@hydris/ui/tile-header";
import type { Metric } from "@projectqai/proto/metrics";
import { AlertLevel, type MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react-native";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Directions, Gesture, GestureDetector } from "react-native-gesture-handler";

import { PinButton } from "../components/layout/pane-pin-button";
import { usePaneEntity } from "../pane-entity-context";
import { selectEntity, useEntityStore } from "../store/entity-store";
import { useSelectionStore } from "../store/selection-store";
import {
  formatCompactRelativeTime,
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

export type MetricTileConfig = {
  title: string;
  icon: LucideIcon;
  categories: MetricCategory[];
  // Hero selection: heroIds wins if any metric matches, else heroPriority by kind.
  heroIds?: ReadonlySet<number>;
  heroPriority?: MetricKind[];
  gaugeRanges?: Partial<Record<MetricKind, GaugeRange>>;
  // Rows per page (omit to fill). minRows is the floor kept on page one.
  supportingPerPage?: number;
  minRows?: number;
};

type Display = {
  label: string;
  short: string;
  value: string;
  unit: string;
  health: HealthLevel | null;
  rawValue: number;
  kind: MetricKind | undefined;
};

// yellow/red as literal classes, not theme tokens: the warning token is orange.
const HEALTH_TEXT: Record<HealthLevel, string> = {
  good: "text-green",
  moderate: "text-yellow",
  poor: "text-red",
};

function alertToHealth(m: Metric): HealthLevel | null {
  if (m.alerting == null || m.alerting === AlertLevel.AlertLevelNone) return null;
  return m.alerting === AlertLevel.AlertLevelWarning ? "moderate" : "poor";
}

function gaugePosition(
  rawValue: number,
  kind: MetricKind | undefined,
  ranges: Partial<Record<MetricKind, GaugeRange>> | undefined,
): number | null {
  if (!ranges || kind == null) return null;
  const range = ranges[kind];
  if (!range) return null;
  const clamped = Math.max(range.min, Math.min(range.max, rawValue));
  const pos = (clamped - range.min) / (range.max - range.min);
  return range.inverted ? 1 - pos : pos;
}

function toDisplay(m: Metric): Display {
  const raw = getMetricValue(m);
  const { value, unit } = scaleForDisplay(raw, m.unit);
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: hasDisplayFloor(unit) ? 2 : 1 });
  const label = getMetricLabel(m);
  return {
    label,
    short: label.split(/\s+/)[0] ?? label,
    value: formatted,
    unit: getUnitSymbol(unit),
    health: alertToHealth(m),
    rawValue: m.unit === MetricUnit.MetricUnitRatio ? value : raw,
    kind: m.kind ?? undefined,
  };
}

function pickHero(
  metrics: Metric[],
  heroIds: ReadonlySet<number> | undefined,
  heroPriority: MetricKind[] | undefined,
): { hero: Metric; supporting: Metric[] } {
  const takeAt = (idx: number) => ({
    hero: metrics[idx]!,
    supporting: [...metrics.slice(0, idx), ...metrics.slice(idx + 1)],
  });
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

// Density steps, largest first. `bare` drops the inset card so the smallest
// tiles reclaim row height. `short` abbreviates labels to the first word.
type Tier = {
  hero: number;
  unit: number;
  label: number;
  rowLabel: number;
  rowValue: number;
  rowPadV: number;
  rowPadH: number;
  rowGap: number;
  sectionGap: number;
  short: boolean;
  bare: boolean;
};
const TIERS: Tier[] = [
  {
    hero: 36,
    unit: 15,
    label: 14,
    rowLabel: 14,
    rowValue: 15,
    rowPadV: 8,
    rowPadH: 13,
    rowGap: 6,
    sectionGap: 8,
    short: false,
    bare: false,
  },
  {
    hero: 32,
    unit: 14,
    label: 13,
    rowLabel: 13,
    rowValue: 14,
    rowPadV: 6,
    rowPadH: 11,
    rowGap: 5,
    sectionGap: 6,
    short: false,
    bare: false,
  },
  {
    hero: 28,
    unit: 12,
    label: 12,
    rowLabel: 12,
    rowValue: 13,
    rowPadV: 5,
    rowPadH: 9,
    rowGap: 4,
    sectionGap: 5,
    short: true,
    bare: false,
  },
  {
    hero: 22,
    unit: 11,
    label: 11,
    rowLabel: 11,
    rowValue: 12,
    rowPadV: 4,
    rowPadH: 7,
    rowGap: 3,
    sectionGap: 4,
    short: true,
    bare: false,
  },
  {
    hero: 18,
    unit: 10,
    label: 10,
    rowLabel: 10,
    rowValue: 11,
    rowPadV: 2,
    rowPadH: 2,
    rowGap: 2,
    sectionGap: 3,
    short: true,
    bare: true,
  },
];

const GAUGE_MAX_WIDTH = 180;
const EMPTY_PIN_SIZE = 18;

function gaugeBlockHeight(t: Tier): number {
  return Math.round(t.rowValue * 1.1) + Math.round(t.sectionGap * 0.6);
}
function rowHeight(t: Tier): number {
  return Math.max(t.rowLabel, t.rowValue) * 1.32 + (t.bare ? 4 : t.rowPadV * 2 + 2);
}
function heroBlockHeight(t: Tier, hasGauge: boolean, hasPager: boolean): number {
  let h = t.hero * 1.05 + t.sectionGap * 0.5 + t.label * 1.35;
  if (hasGauge) h += gaugeBlockHeight(t);
  if (hasPager) h += t.label * 1.4 + t.sectionGap * 0.5;
  return h;
}
// measured for Inter-SemiBold: tabular digits 0.65em, "." 0.27em, unit ~0.62em/char
function heroValueEm(value: string): number {
  let em = 0;
  for (const ch of value) em += ch >= "0" && ch <= "9" ? 0.65 : 0.28;
  return em;
}

function HealthGauge({ position, t }: { position: number; t: Tier }) {
  const barHeight = Math.max(3, Math.round(t.rowValue * 0.34));
  const capHeight = Math.round(t.rowValue * 1.1);
  const capWidth = Math.round(capHeight * 0.6);
  return (
    <View
      style={{
        height: capHeight,
        width: "100%",
        maxWidth: GAUGE_MAX_WIDTH,
        justifyContent: "center",
        marginTop: Math.round(t.sectionGap * 0.6),
      }}
    >
      <LinearGradient
        colors={["#22c55e", "#a3e635", "#facc15", "#f97316", "#ef4444"]}
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
            boxShadow: "0 2px 4px rgba(0,0,0,0.6)",
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

function MetricRow({
  item,
  tier,
  t,
}: {
  item: Display;
  tier: Tier;
  t: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View
      className={cn("flex-row items-center justify-between rounded-lg", !tier.bare && "border")}
      style={
        tier.bare
          ? { paddingHorizontal: tier.rowPadH, paddingVertical: 1 }
          : {
              backgroundColor: t.insetBg,
              borderColor: t.insetBorder,
              borderBottomColor: t.insetHighlight,
              paddingHorizontal: tier.rowPadH,
              paddingVertical: tier.rowPadV,
              boxShadow: t.insetShadow,
            }
      }
    >
      <Text
        className="text-foreground/70 shrink"
        style={{ fontSize: tier.rowLabel }}
        numberOfLines={1}
      >
        {tier.short ? item.short : item.label}
      </Text>
      <Text
        className={cn(
          "font-sans-medium ml-2 shrink-0 tabular-nums",
          item.health ? HEALTH_TEXT[item.health] : "text-foreground",
        )}
        style={{ fontSize: tier.rowValue }}
        numberOfLines={1}
      >
        {item.value}
        {item.unit ? <Text className="text-foreground/60"> {item.unit}</Text> : null}
      </Text>
    </View>
  );
}

function Hero({
  hero,
  tier,
  gaugePos,
  withPager,
  page,
  pages,
  onPage,
}: {
  hero: Display;
  tier: Tier;
  gaugePos: number | null;
  withPager: boolean;
  page: number;
  pages: number;
  onPage: (d: number) => void;
}) {
  return (
    <View className="w-full items-center">
      <Text
        className={cn(
          "leading-none tabular-nums",
          Platform.OS === "web" ? "font-sans-semibold" : "font-sans-bold",
          hero.health ? HEALTH_TEXT[hero.health] : "text-foreground",
        )}
        style={{ fontSize: tier.hero }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {hero.value}
        {hero.unit ? (
          <Text
            className="text-foreground/60"
            style={{ fontSize: tier.unit }}
          >{` ${hero.unit}`}</Text>
        ) : null}
      </Text>
      <Text
        className="font-sans-semibold text-foreground/80"
        style={{ fontSize: tier.label, marginTop: tier.sectionGap * 0.4 }}
        numberOfLines={1}
      >
        {hero.label}
      </Text>
      {gaugePos != null ? <HealthGauge position={gaugePos} t={tier} /> : null}
      {withPager && pages > 1 ? (
        <Pager
          page={page}
          pages={pages}
          onPage={onPage}
          size={tier.label + 2}
          marginTop={tier.sectionGap * 0.5}
        />
      ) : null}
    </View>
  );
}

function Pager({
  page,
  pages,
  onPage,
  size,
  marginTop = 0,
}: {
  page: number;
  pages: number;
  onPage: (d: number) => void;
  size: number;
  marginTop?: number;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-center" style={{ gap: 6, marginTop }}>
      <Pressable
        onPress={() => onPage(-1)}
        aria-label="Previous page"
        hitSlop={8}
        className="hover:bg-glass-hover active:bg-surface-overlay/12 rounded p-0.5"
      >
        <ChevronLeft aria-hidden size={size} color={t.iconMuted} strokeWidth={2} />
      </Pressable>
      <Text
        className="font-sans-medium text-foreground/60 tabular-nums"
        style={{ fontSize: size - 2 }}
      >
        {page + 1}/{pages}
      </Text>
      <Pressable
        onPress={() => onPage(1)}
        aria-label="Next page"
        hitSlop={8}
        className="hover:bg-glass-hover active:bg-surface-overlay/12 rounded p-0.5"
      >
        <ChevronRight aria-hidden size={size} color={t.iconMuted} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function headerSizes(t: Tier): TileHeaderSizes {
  return { name: t.label, text: t.rowLabel, icon: Math.round(t.label * 1.3), gap: t.sectionGap };
}

type MetricTileProps = {
  config: MetricTileConfig;
  entityId?: string;
  // Per-field overrides of the default header (entity label + relative time + pin).
  header?: Partial<TileHeaderContent>;
};

export function MetricTile({ config, entityId, header }: MetricTileProps) {
  const t = useThemeColors();
  const isScreenLocked = useIsScreenLocked();
  const selectedId = useSelectionStore((s) => s.selectedEntityId);
  const { entityId: paneEntityId, onPin } = usePaneEntity();
  const effectiveId = entityId ?? paneEntityId ?? selectedId;
  const entity = useEntityStore(selectEntity(effectiveId));
  const { size, onLayout } = useTileMeasure();
  // the header is sized from the outer box, not the body box it sits above.
  // sizing it from the body would feed its own height back into its input
  // and oscillate when a tier threshold falls inside that height delta.
  const { size: outerSize, onLayout: onOuterLayout } = useTileMeasure();
  const [page, setPage] = useState(0);
  // the fit must not follow per-tick value length jitter ("0.1" vs "0.11"
  // flips the tier at a boundary and the tile re-arranges every update), so
  // the hero width budget only grows while the same hero is shown.
  const heroEmRef = useRef({ key: "", em: 0 });

  const { hero, supporting, timestamp } = useMemo(() => {
    const categorySet = new Set(config.categories);
    const filtered = (entity?.metric?.metrics ?? []).filter(
      (m) => m.kind != null && categorySet.has(getMetricCategory(m)),
    );
    if (filtered.length === 0) return { hero: null, supporting: [], timestamp: null };
    const picked = pickHero(filtered, config.heroIds, config.heroPriority);
    return {
      hero: toDisplay(picked.hero),
      supporting: picked.supporting.map(toDisplay),
      timestamp: getSharedTimestamp(filtered, { strict: false }),
    };
  }, [entity, config.categories, config.heroIds, config.heroPriority]);

  const swipe = useMemo(
    () =>
      Gesture.Race(
        Gesture.Fling()
          .enabled(!isScreenLocked)
          .direction(Directions.LEFT)
          .runOnJS(true)
          .onEnd(() => setPage((p) => p + 1)),
        Gesture.Fling()
          .enabled(!isScreenLocked)
          .direction(Directions.RIGHT)
          .runOnJS(true)
          .onEnd(() => setPage((p) => p - 1)),
      ),
    [isScreenLocked],
  );

  if (!hero) {
    return (
      // same structure and layout handlers as the content branch. the branch
      // swap reuses these nodes, and a handler that only appears after the
      // swap never fires, leaving the measured size at zero.
      <View className="min-h-0 flex-1" onLayout={onOuterLayout}>
        {header ? (
          <TileHeader content={{ name: header.name, meta: header.meta }} />
        ) : onPin ? (
          <View className="flex-row justify-end">
            <PinButton pinned={!!paneEntityId} onPress={onPin} size={EMPTY_PIN_SIZE} />
          </View>
        ) : null}
        <View className="min-h-0 flex-1" onLayout={onLayout}>
          <EmptyState
            icon={config.icon}
            title={config.title}
            subtitle={effectiveId ? "No metrics available" : "Select an entity or pin one"}
          />
        </View>
      </View>
    );
  }

  const gaugePos = gaugePosition(hero.rawValue, hero.kind, config.gaugeRanges);
  const perPageCap = config.supportingPerPage ?? Number.POSITIVE_INFINITY;
  const minRows = config.minRows ?? 1;

  const heroKey = `${effectiveId}:${hero.kind ?? hero.label}`;
  if (heroEmRef.current.key !== heroKey) heroEmRef.current = { key: heroKey, em: 0 };
  heroEmRef.current.em = Math.max(heroEmRef.current.em, heroValueEm(hero.value));
  const heroEm = heroEmRef.current.em;

  const geometry = (tier: Tier): TileGeometry => ({
    heroBlock: heroBlockHeight(tier, gaugePos != null, supporting.length > minRows),
    heroWidth: heroEm * tier.hero + (hero.unit ? (hero.unit.length + 1) * 0.62 * tier.unit : 0),
    row: rowHeight(tier),
    rowGap: tier.rowGap,
    sectionGap: tier.sectionGap,
  });
  const {
    tier,
    wide,
    perPage: fit,
  } = chooseTileFit({
    width: size.width,
    height: size.height,
    rowCount: supporting.length,
    minRows: Math.min(supporting.length, minRows),
    tiers: TIERS,
    geometry,
  });
  // header follows the tile's size, not its content density: size it from the
  // tier a reference hero+3-row tile would get in this box.
  const { tier: headerTier } = chooseTileFit({
    width: outerSize.width,
    height: outerSize.height,
    rowCount: 3,
    minRows: 3,
    tiers: TIERS,
    geometry: (t) => ({
      heroBlock: heroBlockHeight(t, false, false),
      row: rowHeight(t),
      rowGap: t.rowGap,
      sectionGap: t.sectionGap,
    }),
  });
  const perPage = Math.max(1, Math.min(fit, perPageCap));
  const heroOnly = fit <= 0 || supporting.length === 0;
  const totalPages = heroOnly ? 1 : Math.max(1, Math.ceil(supporting.length / perPage));
  const cur = ((page % totalPages) + totalPages) % totalPages;
  const pageRows = heroOnly ? [] : supporting.slice(cur * perPage, (cur + 1) * perPage);
  const showPager = !heroOnly && totalPages > 1;

  const rows = (
    <View style={{ gap: tier.rowGap }}>
      {pageRows.map((item, i) => (
        <MetricRow key={`${item.label}-${i}`} item={item} tier={tier} t={t} />
      ))}
    </View>
  );
  const heroBlock = (
    <Hero
      hero={hero}
      tier={tier}
      gaugePos={gaugePos}
      withPager={showPager}
      page={cur}
      pages={totalPages}
      onPage={(d) => setPage((p) => p + d)}
    />
  );

  let inner: ReactNode;
  if (heroOnly) {
    inner = <View className="flex-1 items-center justify-center">{heroBlock}</View>;
  } else if (wide) {
    inner = (
      <View className="flex-1 flex-row items-center" style={{ gap: tier.sectionGap * 2 }}>
        <View className="items-center justify-center" style={{ flex: 2 }}>
          {heroBlock}
        </View>
        <View className="justify-center" style={{ flex: 3 }}>
          {rows}
        </View>
      </View>
    );
  } else {
    inner = (
      <View className="flex-1 justify-center" style={{ gap: tier.sectionGap * 1.5 }}>
        {heroBlock}
        {rows}
      </View>
    );
  }

  const headerContent: TileHeaderContent = {
    name: header?.name ?? entity?.label ?? entity?.id,
    timestamp: header?.timestamp ?? (timestamp ? formatCompactRelativeTime(timestamp) : undefined),
    meta:
      header?.meta ??
      ((s) => (onPin ? <PinButton pinned={!!paneEntityId} onPress={onPin} size={s.icon} /> : null)),
  };

  // No overflow-hidden on the body: the frame clips with padding, and an
  // overflow box flush against the rows squares off their rounded corners.
  const content = (
    // min-h-0: react-native-web flex items default to min-height auto, so an
    // overflowing body would grow, report its own height back through onLayout
    // and the fit gets stuck on an oversized tier.
    <View className="min-h-0 flex-1" onLayout={onOuterLayout}>
      <TileHeader content={headerContent} sizes={headerSizes(headerTier)} />
      <View className="min-h-0 flex-1" onLayout={onLayout}>
        {inner}
      </View>
    </View>
  );

  return totalPages > 1 ? <GestureDetector gesture={swipe}>{content}</GestureDetector> : content;
}
