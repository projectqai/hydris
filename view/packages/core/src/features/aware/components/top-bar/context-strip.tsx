"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Wifi, WifiOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useEntityStore } from "../../store/entity-store";

function Inset({ children }: { children: React.ReactNode }) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-3 rounded px-2 py-2.5"
      style={{
        borderWidth: 1,
        borderColor: t.insetBorder,
        backgroundColor: t.insetBg,
        borderBottomColor: t.insetHighlight,
        // @ts-ignore react-native-web CSS property
        boxShadow: t.insetShadow,
      }}
    >
      {children}
    </View>
  );
}

function ConnectionIndicator() {
  const t = useThemeColors();
  const isConnected = useEntityStore((s) => s.isConnected);
  const error = useEntityStore((s) => s.error);

  const isDisconnected = !!error;
  const Icon = isDisconnected ? WifiOff : Wifi;
  const color = isDisconnected
    ? "rgb(239, 68, 68)"
    : isConnected
      ? t.activeGreen
      : "rgb(251, 191, 36)";
  const label = isDisconnected ? "Disconnected" : isConnected ? "Connected" : "Connecting";

  return (
    <View role="status" accessible accessibilityLabel={label} className="flex-row items-center">
      <Icon aria-hidden size={15} strokeWidth={1.8} color={color} />
    </View>
  );
}

export function ContextStrip({ showConnection = true }: { showConnection?: boolean }) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const localTime = format(time, "HH:mm:ss");
  const zuluTime = formatInTimeZone(time, "UTC", "HH:mm:ss");
  const date = format(time, "dd MMM").toUpperCase();

  return (
    <View className="flex-row items-stretch gap-1.5">
      <Inset>
        <View
          role="group"
          accessible
          accessibilityLabel={`Local time ${localTime}`}
          className="flex-row items-baseline gap-0.5"
        >
          <Text
            className="text-13 text-on-surface/70 font-mono"
            style={{ fontVariant: ["tabular-nums"], letterSpacing: -0.3 }}
          >
            {localTime}
          </Text>
          <Text aria-hidden className="text-9 text-on-surface/70 font-mono">
            L
          </Text>
        </View>

        <View className="bg-surface-overlay/15 h-3.5 w-px" />

        <View
          role="group"
          accessible
          accessibilityLabel={`Zulu time ${zuluTime}`}
          className="flex-row items-baseline gap-0.5"
        >
          <Text
            className="text-13 text-on-surface/70 font-mono"
            style={{ fontVariant: ["tabular-nums"], letterSpacing: -0.3 }}
          >
            {zuluTime}
          </Text>
          <Text aria-hidden className="text-9 text-on-surface/70 font-mono">
            Z
          </Text>
        </View>

        <View className="bg-surface-overlay/15 h-3.5 w-px" />

        <Text
          accessibilityLabel={`Date ${date}`}
          className="text-13 text-on-surface/70 font-mono"
          style={{ letterSpacing: 1 }}
        >
          {date}
        </Text>
      </Inset>

      {showConnection && (
        <Inset>
          <ConnectionIndicator />
        </Inset>
      )}
    </View>
  );
}
