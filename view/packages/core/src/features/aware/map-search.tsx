import { ATTRIBUTIONS } from "@hydris/map-engine/constants";
import { Text } from "react-native";

import { useMapStore } from "./store/map-store";
import { useVersionLabel } from "./store/version-store";

export const LIGHT_LAYERS: Set<string> = new Set(["street"]);

export function MapAttribution() {
  const baseLayer = useMapStore((s) => s.layer);
  const versionLabel = useVersionLabel();
  const isLight = LIGHT_LAYERS.has(baseLayer);
  const color = isLight ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.45)";
  return (
    <Text
      style={{
        position: "absolute",
        bottom: 4,
        left: 0,
        right: 0,
        fontSize: 10,
        lineHeight: 14,
        color,
        textAlign: "center",
      }}
      pointerEvents="none"
    >
      {versionLabel ? `${versionLabel} | ` : ""}
      {ATTRIBUTIONS[baseLayer]}
    </Text>
  );
}
