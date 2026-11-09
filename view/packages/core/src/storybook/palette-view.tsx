import { KeyboardProvider } from "@hydris/ui/keyboard";
import { cn } from "@hydris/ui/lib/utils";
import type { Decorator } from "@storybook/react-native-web-vite";
import { View } from "react-native";

export function paletteView({
  height = "h-[440px]",
  keyboard = true,
}: { height?: "h-[440px]" | "h-80"; keyboard?: boolean } = {}): Decorator {
  return (Story) => {
    const frame = (
      <View className={cn("native:flex-1 w-[560px]", height)}>
        <Story />
      </View>
    );

    return keyboard ? <KeyboardProvider>{frame}</KeyboardProvider> : frame;
  };
}
