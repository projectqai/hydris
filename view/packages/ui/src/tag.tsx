import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function Tag({ children }: { children: ReactNode }) {
  return (
    <View className="bg-surface-overlay/6 h-4 items-center justify-center rounded px-1">
      <Text className="text-11 text-on-surface/70 font-mono leading-none tabular-nums">
        {children}
      </Text>
    </View>
  );
}
