import { cn } from "@hydris/ui/lib/utils";
import { Platform, Text, View } from "react-native";

import type { LevelsReading, LevelValue } from "../types";
import { BASE, useWidgetScale } from "./scale-context";
import { SensorWidgetShell } from "./sensor-widget-shell";

const DEFAULT_MAX_BARS = 8;
const DEFAULT_DISPLAY_SLOTS = 3;

type Props = {
  entityId: string;
  maxBars?: number;
  displaySlots?: number;
};

function getBarColor(index: number, value: number): string {
  if (index >= value) return "bg-surface-overlay/6";
  if (value >= 6) return "bg-red";
  if (value >= 3) return "bg-warning";
  return "bg-green";
}

function LevelRow({ level, maxBars }: { level: LevelValue | null; maxBars: number }) {
  const { body, element } = useWidgetScale();
  const barHeight = Math.round(BASE.barHeight * element);
  const barGap = Math.round(BASE.barGap * element);
  const empty = !level;

  return (
    <View style={{ paddingBottom: BASE.rowGap * element }} className={cn(empty && "opacity-30")}>
      <View className="flex-row items-center justify-between">
        <Text
          className="font-sans-semibold text-foreground/80 tracking-wider uppercase"
          style={{ fontSize: BASE.labelText * body }}
        >
          {level?.code ?? "---"}
        </Text>
        <Text
          className={cn(
            "text-foreground text-right tabular-nums",
            Platform.OS === "web" ? "font-sans-semibold" : "font-sans-bold",
          )}
          style={{ fontSize: BASE.valueText * body }}
        >
          {empty ? "-" : level.value}
          <Text className="text-foreground/70">/{maxBars}</Text>
        </Text>
      </View>
      <View style={{ height: barHeight, marginTop: barGap, gap: barGap }} className="flex-row">
        {Array.from({ length: maxBars }).map((_, i) => (
          <View
            key={i}
            className={cn(
              "flex-1 rounded",
              empty ? "bg-foreground/12" : getBarColor(i, level.value),
            )}
          />
        ))}
      </View>
    </View>
  );
}

function LevelsDisplay({
  reading,
  maxBars,
  displaySlots,
}: {
  reading: LevelsReading;
  maxBars: number;
  displaySlots: number;
}) {
  const sorted = [...reading.levels]
    .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code))
    .slice(0, displaySlots);

  const hasAny = reading.levels.length > 0;
  const slots: (LevelValue | null)[] = Array.from(
    { length: displaySlots },
    (_, i) => sorted[i] ?? null,
  );

  return (
    <View className="flex-1 justify-center">
      {slots.map((level, i) => (
        <LevelRow
          key={level?.code ?? `empty-${i}`}
          level={hasAny ? level : null}
          maxBars={maxBars}
        />
      ))}
    </View>
  );
}

export function LevelsWidget({
  entityId,
  maxBars = DEFAULT_MAX_BARS,
  displaySlots = DEFAULT_DISPLAY_SLOTS,
}: Props) {
  return (
    <SensorWidgetShell entityId={entityId}>
      {(data) =>
        data.reading?.shape === "levels" ? (
          <LevelsDisplay reading={data.reading} maxBars={maxBars} displaySlots={displaySlots} />
        ) : null
      }
    </SensorWidgetShell>
  );
}
