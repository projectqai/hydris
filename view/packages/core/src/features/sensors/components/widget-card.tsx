"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { BellOff, Lock, TriangleAlert, Wifi, WifiOff, X } from "lucide-react-native";
import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { CardStatus, ConnectionState, SignalStrength } from "../types";
import { BASE, computeScale, ScaleContext } from "./scale-context";
import { VignetteGlow } from "./vignette-glow";

type WidgetCardProps = PropsWithChildren<{
  status?: CardStatus;
  sensorName?: string;
  timestamp?: string;
  connectionState?: ConnectionState;
  signalStrength?: SignalStrength;
  isSilentMode?: boolean;
  hasReading?: boolean;
  hasSensorError?: boolean;
  hasDecodeErrors?: boolean;
  onRemove?: () => void;
  glowColor?: string;
  glowIntensity?: number;
  isLocked?: boolean;
}>;

const SIGNAL_LABELS: Record<ConnectionState, string> & Record<SignalStrength, string> = {
  disconnected: "Disconnected",
  reconnecting: "Reconnecting...",
  connected: "...",
  high: "HIGH",
  med: "MED",
  low: "LOW",
};

function useDisconnectPulse(status: CardStatus) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (status === "disconnected") {
      opacity.value = withRepeat(withTiming(0.3, { duration: 800 }), -1, true);
    } else {
      cancelAnimation(opacity);
      opacity.value = withTiming(1, { duration: 100 });
    }
  }, [status, opacity]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

function useReconnectPulse(connectionState: ConnectionState) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (connectionState === "reconnecting") {
      opacity.value = withRepeat(withTiming(0.3, { duration: 800 }), -1, true);
    } else {
      cancelAnimation(opacity);
      opacity.value = withTiming(1, { duration: 100 });
    }
  }, [connectionState, opacity]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

function useSignalInfo(
  connectionState: ConnectionState,
  signalStrength: SignalStrength | undefined,
  t: ReturnType<typeof useThemeColors>,
): { color: string; label: string } {
  if (connectionState === "disconnected")
    return { color: t.destructiveRed, label: SIGNAL_LABELS.disconnected };
  if (connectionState === "reconnecting")
    return { color: t.warning, label: SIGNAL_LABELS.reconnecting };
  if (!signalStrength) return { color: t.foreground, label: SIGNAL_LABELS.connected };

  const colorMap: Record<SignalStrength, string> = {
    high: "#22c55e",
    med: "#f59e0b",
    low: t.destructiveRed,
  };
  return { color: colorMap[signalStrength], label: SIGNAL_LABELS[signalStrength] };
}

export function WidgetCard({
  children,
  status = "normal",
  sensorName,
  timestamp,
  connectionState = "connected",
  signalStrength,
  isSilentMode = false,
  hasReading = true,
  hasSensorError = false,
  hasDecodeErrors = false,
  onRemove,
  glowColor,
  glowIntensity = 0,
  isLocked = false,
}: WidgetCardProps) {
  const t = useThemeColors();
  const pulseStyle = useDisconnectPulse(status);
  const reconnectPulse = useReconnectPulse(connectionState);
  const [scale, setScale] = useState(() => computeScale(400, 400));
  const signal = useSignalInfo(connectionState, signalStrength, t);

  const nameFontSize = Math.max(12, Math.round(BASE.labelText * scale.body));
  const iconSize = Math.round(nameFontSize * 1.25);
  const metaFontSize = Math.max(10, Math.round(BASE.smallText * scale.body));

  return (
    <Animated.View style={[{ flex: 1 }, pulseStyle]}>
      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setScale(computeScale(width, height));
        }}
        className={cn(
          "border-background bg-background flex-1 border",
          status === "alarm" && "border-red",
          status === "cooldown" && "border-warning",
          status === "disconnected" && "border-red/50",
        )}
      >
        <View
          className="flex-1 overflow-hidden"
          style={{ padding: Math.round(BASE.padding * scale.padding) }}
        >
          {glowColor && glowIntensity > 0 ? (
            <VignetteGlow color={glowColor} intensity={glowIntensity} />
          ) : null}
          {sensorName && (
            <View
              className="flex-row items-center justify-between"
              style={{ marginBottom: BASE.sectionGap * scale.body }}
            >
              <Text
                className="font-sans-semibold text-foreground/80 min-w-0 shrink"
                style={{ fontSize: Math.max(12, Math.round(BASE.labelText * scale.body)) }}
                numberOfLines={1}
              >
                {sensorName}
              </Text>
              <View className="ml-3 shrink-0 flex-row items-center" style={{ gap: 8 * scale.body }}>
                {hasSensorError && (
                  <TriangleAlert size={iconSize} color={t.destructiveRed} strokeWidth={2} />
                )}
                {hasDecodeErrors && !hasSensorError && (
                  <TriangleAlert size={iconSize} color={t.warning} strokeWidth={2} />
                )}
                {isSilentMode && <BellOff size={iconSize} color={t.warning} strokeWidth={2} />}
                <Text
                  className="font-sans-semibold text-foreground/70 tabular-nums"
                  style={{ fontSize: metaFontSize }}
                >
                  {timestamp}
                </Text>
                <Animated.View style={reconnectPulse} className="flex-row items-center">
                  <View className="flex-row items-center" style={{ gap: 4 * scale.body }}>
                    <Wifi size={iconSize} color={signal.color} strokeWidth={2} />
                    <Text
                      className="font-sans-semibold text-foreground/70"
                      style={{ fontSize: metaFontSize }}
                    >
                      {signal.label}
                    </Text>
                  </View>
                </Animated.View>
              </View>
            </View>
          )}
          <ScaleContext.Provider value={scale}>
            <View className="flex-1">
              {status === "disconnected" && !hasReading ? (
                <View className="flex-1 items-center justify-center gap-4">
                  <Animated.View style={reconnectPulse}>
                    <WifiOff size={32} color={t.destructiveRed} strokeWidth={2} />
                  </Animated.View>
                  <Text className="font-sans-semibold text-red text-sm">Connection lost</Text>
                  {onRemove && (
                    <Pressable
                      onPress={onRemove}
                      className="border-red/40 bg-red/20 flex-row items-center gap-2 rounded-lg border px-4 py-2"
                    >
                      <X size={16} color={t.destructiveRed} strokeWidth={2} />
                      <Text className="font-sans-semibold text-red text-sm">Remove</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                children
              )}
            </View>
          </ScaleContext.Provider>
          {isLocked && (
            <View className="bg-background/95 pointer-events-none absolute inset-0 items-center justify-center">
              <Lock size={Math.round(36 * scale.body)} color={t.foreground} strokeWidth={1.25} />
              <Text
                className="font-sans-semibold text-foreground mt-2 uppercase"
                style={{ fontSize: Math.max(10, Math.round(BASE.smallText * scale.body)) }}
              >
                Locked
              </Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}
