import { useThemeColors } from "@hydris/ui/lib/theme";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function ModeBarHeader({
  icon: Icon,
  label,
  help,
}: {
  icon?: LucideIcon;
  label: string;
  help?: ReactNode;
}) {
  const t = useThemeColors();

  return (
    <View className="flex-1 flex-row items-center gap-1.5">
      {Icon && <Icon aria-hidden size={14} strokeWidth={1.5} color={t.placementAccent} />}
      <Text className="font-sans-medium text-11" style={{ color: t.placementAccent }}>
        {label}
      </Text>
      {help}
    </View>
  );
}
