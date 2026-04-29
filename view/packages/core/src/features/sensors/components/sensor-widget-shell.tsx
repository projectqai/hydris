import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import type { LucideIcon } from "lucide-react-native";
import { Activity } from "lucide-react-native";
import type { ReactNode } from "react";
import { useContext, useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PaletteContext } from "../../aware/palette-context";
import { calculateGlow, useGlowColors } from "../colors";
import type { SensorWidgetData } from "../types";
import { registerMonitoredEntity } from "../use-alarm-effects";
import { useSensorData } from "../use-sensor-data";
import { WidgetCard } from "./widget-card";

type Props = {
  entityId: string;
  icon?: LucideIcon;
  children: (data: SensorWidgetData) => ReactNode;
};

export function SensorWidgetShell({ entityId, icon = Activity, children }: Props) {
  useEffect(() => registerMonitoredEntity(entityId), [entityId]);

  const palette = useContext(PaletteContext);
  const colors = useGlowColors();
  const t = useThemeColors();
  const data = useSensorData(entityId);

  if (!data) return <EmptyState icon={icon} title="Sensor" subtitle="No data available" />;

  const glow =
    data.status === "cooldown" ? { color: "", intensity: 0 } : calculateGlow(data, colors);

  return (
    <Pressable onPress={() => palette.open({ kind: "config", entityId })} style={{ flex: 1 }}>
      <WidgetCard
        status={data.status}
        sensorName={data.name}
        timestamp={data.timestamp ?? "--:--"}
        connectionState={data.connectionState}
        signalStrength={data.signalStrength}
        glowColor={glow.color}
        glowIntensity={glow.intensity}
        isLocked={data.isLocked}
        isSilentMode={data.isSilent}
      >
        {data.isInitializing ? (
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
