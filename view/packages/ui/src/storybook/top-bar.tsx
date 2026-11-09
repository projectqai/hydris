import type { Decorator } from "@storybook/react-native-web-vite";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { useThemeColors } from "../lib/theme";

type Tone = "placement" | "customize";

function TopBarFrame({
  label,
  tone,
  children,
}: {
  label: string;
  tone: Tone;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const customize = tone === "customize";

  return (
    <View className="h-64">
      <View
        className="flex-row items-center gap-2 self-start rounded-md px-3 py-2"
        style={{ backgroundColor: customize ? t.topBarCustomizeBg : t.topBarPlacementBg }}
      >
        <Text
          className="font-sans-medium text-11 text-foreground"
          style={customize ? { color: t.customizeAccent } : undefined}
        >
          {label}
        </Text>
        {children}
      </View>
    </View>
  );
}

export function topBar(label: string, tone: Tone = "placement"): Decorator {
  return (Story) => (
    <TopBarFrame label={label} tone={tone}>
      <Story />
    </TopBarFrame>
  );
}
