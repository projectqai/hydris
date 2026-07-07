"use no memo";

import { useThemeColors } from "@hydris/ui/lib/theme";
import { ListChecks } from "lucide-react-native";
import { useContext } from "react";
import { Pressable, Text, View } from "react-native";

import { useNotReadyCounts } from "../../hooks/use-asset-readiness";
import { PaletteContext } from "../../palette-context";
import { Inset } from "./inset";

export function AssetReadinessIndicator() {
  const t = useThemeColors();
  const palette = useContext(PaletteContext);
  const { notReady, failed } = useNotReadyCounts();
  if (notReady === 0) return null;

  const color = failed > 0 ? t.redForeground : t.pendingForeground;
  const label = `${notReady} ${notReady === 1 ? "asset" : "assets"} not ready, show asset readiness`;

  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={() => palette.open({ kind: "asset-readiness" })}
      className="outline-none hover:opacity-80 active:opacity-70"
    >
      <Inset>
        <View className="flex-row items-center gap-1.5">
          <ListChecks aria-hidden size={15} strokeWidth={1.8} color={color} />
          <Text className="text-13 font-mono" style={{ color, fontVariant: ["tabular-nums"] }}>
            {notReady}
          </Text>
        </View>
      </Inset>
    </Pressable>
  );
}
