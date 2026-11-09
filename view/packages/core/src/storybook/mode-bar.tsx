import { useThemeColors } from "@hydris/ui/lib/theme";
import type { Decorator } from "@storybook/react-native-web-vite";
import type { ReactNode } from "react";
import { View } from "react-native";

function ModeBar({ helpRoom, children }: { helpRoom: boolean; children: ReactNode }) {
  const t = useThemeColors();
  const bar = (
    <View
      className="min-h-16 flex-row items-center self-stretch px-4 py-2.5"
      style={{ backgroundColor: t.topBarPlacementBg }}
    >
      {children}
    </View>
  );

  if (!helpRoom) return bar;

  return <View className="h-64 self-stretch">{bar}</View>;
}

export function modeBar({ helpRoom = true }: { helpRoom?: boolean } = {}): Decorator {
  return (Story) => (
    <ModeBar helpRoom={helpRoom}>
      <Story />
    </ModeBar>
  );
}
