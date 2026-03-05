import type { LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

export type ThemeColor = "red" | "yellow" | "blue" | "green";

const colorClasses: Record<ThemeColor, string> = {
  red: "bg-red",
  yellow: "bg-yellow",
  blue: "bg-blue",
  green: "bg-green",
};

export type OverlayToggleProps = {
  label: string;
  color?: ThemeColor;
  icon?: LucideIcon;
  isActive: boolean;
  onToggle: () => void;
};

export function OverlayToggle({
  label,
  color,
  icon: Icon,
  isActive,
  onToggle,
}: OverlayToggleProps) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onToggle}
      className={cn(
        "flex-row items-center gap-2 rounded px-2.5 py-1 select-none",
        isActive
          ? "bg-surface-overlay/15 hover:bg-surface-overlay/20 active:bg-surface-overlay/25"
          : "bg-surface-overlay/5 hover:bg-surface-overlay/10 active:bg-surface-overlay/15",
      )}
    >
      {Icon ? (
        <Icon size={12} strokeWidth={1.5} color={isActive ? t.iconActive : t.iconSubtle} />
      ) : color ? (
        <View
          className={cn(
            "size-1.5 rounded-full",
            isActive ? colorClasses[color] : "bg-surface-overlay/30",
          )}
        />
      ) : null}
      <Text
        selectable={false}
        className={cn(
          "font-sans-medium text-sm",
          isActive ? "text-foreground" : "text-on-surface/70",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
