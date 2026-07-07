"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { useMeasuredScale } from "@hydris/ui/lib/widget-scale";
import { TileFrame } from "@hydris/ui/tile-frame";
import { BellOff, Lock, TriangleAlert, Wifi } from "lucide-react-native";
import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { PinButton } from "../../aware/components/layout/pane-pin-button";
import { usePaneEntity } from "../../aware/pane-entity-context";
import type { CardStatus, ConnectionState, SignalStrength } from "../types";
import { BASE, ScaleContext } from "./scale-context";
import { VignetteGlow } from "./vignette-glow";

type WidgetCardProps = PropsWithChildren<{
  status?: CardStatus;
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

export function SensorHeaderMeta({
  connectionState,
  signalStrength,
  isSilentMode = false,
  hasSensorError = false,
  textSize,
  iconSize,
}: {
  connectionState: ConnectionState;
  signalStrength?: SignalStrength;
  isSilentMode?: boolean;
  hasSensorError?: boolean;
  textSize: number;
  iconSize: number;
}) {
  const t = useThemeColors();
  const reconnectPulse = useReconnectPulse(connectionState);
  const signal = useSignalInfo(connectionState, signalStrength, t);
  const { entityId: paneEntityId, onPin } = usePaneEntity();

  return (
    <>
      {hasSensorError && (
        <TriangleAlert
          aria-label="Sensor error"
          size={iconSize}
          color={t.destructiveRed}
          strokeWidth={2}
        />
      )}
      {isSilentMode && (
        <BellOff aria-label="Silent mode" size={iconSize} color={t.warning} strokeWidth={2} />
      )}
      <Animated.View style={reconnectPulse} className="flex-row items-center">
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Wifi aria-hidden size={iconSize} color={signal.color} strokeWidth={2} />
          <Text className="font-sans-semibold text-foreground/70" style={{ fontSize: textSize }}>
            {signal.label}
          </Text>
        </View>
      </Animated.View>
      {onPin ? <PinButton pinned={!!paneEntityId} onPress={onPin} size={iconSize} /> : null}
    </>
  );
}

export function WidgetCard({
  children,
  status = "normal",
  glowColor,
  glowIntensity = 0,
  isLocked = false,
}: WidgetCardProps) {
  const t = useThemeColors();
  const pulseStyle = useDisconnectPulse(status);
  const { scale, onLayout } = useMeasuredScale();

  return (
    <Animated.View style={[{ flex: 1 }, pulseStyle]} onLayout={onLayout}>
      <TileFrame
        className={cn(
          status === "alarm" && "border-red",
          status === "cooldown" && "border-warning",
          status === "disconnected" && "border-red/50",
        )}
      >
        {glowColor && glowIntensity > 0 ? (
          <VignetteGlow color={glowColor} intensity={glowIntensity} />
        ) : null}
        <ScaleContext.Provider value={scale}>
          <View className="flex-1">{children}</View>
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
      </TileFrame>
    </Animated.View>
  );
}
