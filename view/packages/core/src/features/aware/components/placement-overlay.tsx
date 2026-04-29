"use no memo";

import type { BaseLayer } from "@hydris/map-engine/types";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { Text, View } from "react-native";

import { Z } from "../constants";
import { useMapEngineStore } from "../store/map-engine-store";
import { useMapStore } from "../store/map-store";

type PlacementStyle = {
  accent: string;
  shadow: string;
};

const PLACEMENT_STYLES: Record<BaseLayer, PlacementStyle> = {
  dark: {
    accent: "rgb(16, 185, 129)",
    shadow: "rgba(0, 0, 0, 0.85)",
  },
  satellite: {
    accent: "rgb(255, 255, 255)",
    shadow: "rgba(0, 0, 0, 0.85)",
  },
  street: {
    accent: "rgb(15, 23, 42)",
    shadow: "rgba(255, 255, 255, 0.9)",
  },
};

export function PlacementOverlay() {
  const t = useThemeColors();
  const view = useMapEngineStore((s) => s.currentView);
  const baseLayer = useMapStore((s) => s.layer);
  const style = PLACEMENT_STYLES[baseLayer];

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "center",
        alignItems: "center",
        zIndex: Z.SWAP_OVERLAY,
      }}
      pointerEvents="none"
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: style.shadow,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.7,
          shadowRadius: 14,
        }}
      >
        <View
          style={{
            position: "absolute",
            width: 48,
            height: 48,
            borderRadius: 24,
            borderWidth: 2,
            borderColor: style.accent,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: style.shadow,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 6,
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: style.accent,
              shadowColor: style.shadow,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 1,
              shadowRadius: 5,
            }}
          />
        </View>
      </View>
      <View
        style={{
          marginTop: 8,
          backgroundColor: t.paneHeaderBg,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: t.borderSubtle,
        }}
      >
        <Text className="text-11 font-mono" style={{ color: t.foreground, textAlign: "center" }}>
          {view.lat.toFixed(6)}, {view.lng.toFixed(6)}
        </Text>
      </View>
    </View>
  );
}
