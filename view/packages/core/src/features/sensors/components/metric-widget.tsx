import { cn } from "@hydris/ui/lib/utils";
import { Platform, Text, View } from "react-native";

import type { MetricReading } from "../types";
import { BASE, useWidgetScale } from "./scale-context";
import { SensorWidgetShell } from "./sensor-widget-shell";

export type MetricFormat = (value: number, unit: string) => { value: string; unit: string };

const defaultFormat: MetricFormat = (value, unit) => ({ value: value.toFixed(2), unit });

type Props = {
  entityId: string;
  formatPrimary?: MetricFormat;
  formatSecondary?: MetricFormat;
};

function MetricDisplay({
  reading,
  formatPrimary = defaultFormat,
  formatSecondary = defaultFormat,
}: {
  reading: MetricReading;
  formatPrimary?: MetricFormat;
  formatSecondary?: MetricFormat;
}) {
  const { hero, body } = useWidgetScale();
  const primary = formatPrimary(reading.primary.value, reading.primary.unit);
  const secondary = reading.secondary
    ? formatSecondary(reading.secondary.value, reading.secondary.unit)
    : null;

  return (
    <View className="flex-1 justify-center">
      <View style={{ marginBottom: BASE.sectionGap * body }}>
        <Text
          className={cn(
            "text-foreground leading-none tabular-nums",
            Platform.OS === "web" ? "font-sans-semibold" : "font-sans-bold",
          )}
          style={{ fontSize: BASE.heroText * hero }}
        >
          {primary.value}
        </Text>
        <Text
          className="font-sans-semibold text-foreground/70"
          style={{ fontSize: BASE.bodyText * body, marginTop: BASE.sectionGap * body }}
        >
          {primary.unit}
        </Text>
      </View>
      {secondary && (
        <Text
          className="font-sans-semibold text-foreground/70 leading-tight tabular-nums"
          style={{ fontSize: BASE.captionText * body }}
        >
          {secondary.value} {secondary.unit}
        </Text>
      )}
    </View>
  );
}

export function MetricWidget({ entityId, formatPrimary, formatSecondary }: Props) {
  return (
    <SensorWidgetShell entityId={entityId}>
      {(data) =>
        data.reading?.shape === "metric" ? (
          <MetricDisplay
            reading={data.reading}
            formatPrimary={formatPrimary}
            formatSecondary={formatSecondary}
          />
        ) : null
      }
    </SensorWidgetShell>
  );
}
