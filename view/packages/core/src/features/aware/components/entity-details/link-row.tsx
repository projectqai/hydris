import { useThemeColors } from "@hydris/ui/lib/theme";
import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";

type LinkRowProps = {
  icon?: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  value: string;
  onPress: () => void;
  accessibilityLabel: string;
};

export function LinkRow({ icon: Icon, label, value, onPress, accessibilityLabel }: LinkRowProps) {
  const t = useThemeColors();

  return (
    <View className="flex-row items-center gap-2 py-1.5">
      {Icon && (
        <View className="w-5 items-center">
          <Icon size={15} color={t.iconSubtle} strokeWidth={2} />
        </View>
      )}
      <View className="min-w-0 flex-1 flex-row items-center justify-between gap-2">
        <Text className="font-sans-medium text-foreground/75 shrink-0 text-xs" numberOfLines={1}>
          {label}
        </Text>
        <Pressable
          onPress={onPress}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="link"
          className="min-w-0 flex-1 items-end hover:opacity-70 active:opacity-50"
          hitSlop={8}
        >
          <Text numberOfLines={1} className="font-sans-medium text-foreground/90 text-xs underline">
            {value}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
