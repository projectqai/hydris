"use no memo";

import { Command } from "lucide-react-native";
import { Platform, Text, View } from "react-native";

import { ControlButton } from "../controls";
import { IS_MAC } from "../lib/platform";
import { useThemeColors } from "../lib/theme";

export function CommandTrigger({ onPress }: { onPress: () => void }) {
  const t = useThemeColors();
  return (
    <ControlButton onPress={onPress} accessibilityLabel="Open command palette">
      <Text className="font-sans-medium text-13 text-on-surface/75">Commands</Text>
      {Platform.OS === "web" && (
        <View className="bg-surface-overlay/6 h-5 flex-row items-center justify-center gap-0.5 rounded px-1.5">
          {IS_MAC ? (
            <Command aria-hidden size={10} strokeWidth={2} color={t.iconSubtle} />
          ) : (
            <Text aria-hidden className="text-10 text-on-surface/70 font-mono leading-none">
              Ctrl
            </Text>
          )}
          <Text aria-hidden className="text-10 text-on-surface/70 font-mono leading-none">
            K
          </Text>
        </View>
      )}
    </ControlButton>
  );
}
