import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

import { useThemeColors } from "./lib/theme";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
};

export function EmptyState({ icon: Icon, title, subtitle }: EmptyStateProps) {
  const t = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center px-6 select-none">
      {Icon && (
        <View className="mb-2 opacity-60">
          <Icon size={28} color={t.iconActive} strokeWidth={1.5} />
        </View>
      )}
      <Text className="font-sans-medium text-foreground/70 text-center text-sm">{title}</Text>
      {subtitle && (
        <Text className="text-foreground/70 text-center font-sans text-xs leading-relaxed">
          {subtitle}
        </Text>
      )}
    </View>
  );
}
