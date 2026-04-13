import { useThemeColors } from "@hydris/ui/lib/theme";
import { useColorScheme } from "nativewind";
import { Platform } from "react-native";

import type { SensorWidgetData, ThresholdConfig } from "./types";
import { SENSOR_THRESHOLDS } from "./types";

type ColorBoosts = { green: number; warning: number; red: number };

type GlowColors = {
  green: string;
  warning: string;
  red: string;
  boosts: ColorBoosts;
};

/**
 * Per-color intensity boosts for each platform × theme combination.
 *
 * Desktop (web) needs higher values — glow spreads over larger pane area.
 * Light theme needs higher values — glow competes with bright background.
 */
const BOOSTS = {
  dark: {
    native: { green: 1.0, warning: 1.0, red: 1.0 },
    web: { green: 1.4, warning: 1.2, red: 1.0 },
  },
  light: {
    native: { green: 1.2, warning: 1.3, red: 1.6 },
    web: { green: 1.8, warning: 1.5, red: 2.0 },
  },
} as const;

export function useGlowColors(): GlowColors {
  const t = useThemeColors();
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "light" ? "light" : "dark";
  const platform = Platform.OS === "web" ? "web" : "native";

  return {
    green: t.activeGreen,
    warning: t.warning,
    red: t.destructiveRed,
    boosts: BOOSTS[theme][platform],
  };
}

export function calculateGlow(
  data: SensorWidgetData,
  colors: GlowColors,
  thresholds?: ThresholdConfig,
): { color: string; intensity: number } {
  const threshold = thresholds ?? SENSOR_THRESHOLDS[data.kind];
  if (!data.reading || !threshold || threshold.type === "none" || threshold.value === 0)
    return { color: "", intensity: 0 };

  let percentage = 0;
  switch (data.reading.shape) {
    case "metric":
      percentage = data.reading.primary.value / threshold.value;
      break;
    case "levels": {
      const maxValue = Math.max(...data.reading.levels.map((l) => l.value));
      percentage = maxValue / threshold.value;
      break;
    }
  }

  let color: string;
  let intensity: number;
  let boost: number;

  if (percentage < 0.8) {
    color = colors.green;
    intensity = 0.5 - (percentage / 0.8) * 0.2;
    boost = colors.boosts.green;
  } else if (percentage < 0.9) {
    color = colors.warning;
    intensity = 0.4 + (percentage - 0.8) * 3;
    boost = colors.boosts.warning;
  } else if (percentage < 1.0) {
    color = colors.warning;
    intensity = 0.7 + (percentage - 0.9) * 1.5;
    boost = colors.boosts.warning;
  } else {
    color = colors.red;
    intensity = 1.0;
    boost = colors.boosts.red;
  }

  return { color, intensity: Math.min(1.0, intensity * boost) };
}
