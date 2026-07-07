import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { TileHeader } from "@hydris/ui/tile-header";
import type { LucideIcon } from "lucide-react-native";
import { Activity, WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { useContext, useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PaletteContext } from "../../aware/palette-context";
import { formatCompactRelativeTime } from "../../aware/utils/format-metrics";
import { calculateGlow, useGlowColors } from "../colors";
import type { SensorWidgetData } from "../types";
import { registerMonitoredEntity } from "../use-alarm-effects";
import { useSensorData } from "../use-sensor-data";
import { SensorHeaderMeta, WidgetCard } from "./widget-card";

type Props = {
  entityId: string;
  icon?: LucideIcon;
  // the child renders its own tile header
  headerless?: boolean;
  children: (data: SensorWidgetData) => ReactNode;
};

export function SensorWidgetShell({
  entityId,
  icon = Activity,
  headerless = false,
  children,
}: Props) {
  useEffect(() => registerMonitoredEntity(entityId), [entityId]);

  const palette = useContext(PaletteContext);
  const colors = useGlowColors();
  const t = useThemeColors();
  const data = useSensorData(entityId);

  if (!data) return <EmptyState icon={icon} title="Sensor" subtitle="No data available" />;

  const glow =
    data.status === "cooldown" ? { color: "", intensity: 0 } : calculateGlow(data, colors);

  // a replaced body can't render its own header, so the shell takes over
  const bodyReplaced = (data.status === "disconnected" && !data.reading) || data.isInitializing;

  return (
    <Pressable onPress={() => palette.open({ kind: "config", entityId })} style={{ flex: 1 }}>
      <WidgetCard
        status={data.status}
        glowColor={glow.color}
        glowIntensity={glow.intensity}
        isLocked={data.isLocked}
      >
        {(!headerless || bodyReplaced) && (
          <TileHeader
            content={{
              name: data.name,
              timestamp: data.measuredAt ? formatCompactRelativeTime(data.measuredAt) : "--:--",
              meta: (s) => (
                <SensorHeaderMeta
                  connectionState={data.connectionState}
                  signalStrength={data.signalStrength}
                  isSilentMode={data.isSilent}
                  hasSensorError={data.hasSensorError}
                  textSize={s.text}
                  iconSize={s.icon}
                />
              ),
            }}
          />
        )}
        {data.status === "disconnected" && !data.reading ? (
          <View className="flex-1 items-center justify-center gap-4">
            <WifiOff aria-hidden size={32} color={t.destructiveRed} strokeWidth={2} />
            <Text className="font-sans-semibold text-red text-sm">Connection lost</Text>
          </View>
        ) : data.isInitializing ? (
          <View className="flex-1 items-center justify-center gap-4">
            <ActivityIndicator size="large" color={t.warning} />
            <Text className="font-sans-semibold text-warning text-sm">Warming up</Text>
          </View>
        ) : (
          children(data)
        )}
      </WidgetCard>
    </Pressable>
  );
}
