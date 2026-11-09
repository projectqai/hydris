import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";

export function BarIconButton({
  icon: Icon,
  size,
  label,
  disabled = false,
  onPress,
}: {
  icon: LucideIcon;
  size: number;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={-1}
      hitSlop={8}
      className={cn("rounded p-0.5", !disabled && "hover:bg-glass-hover")}
    >
      <Icon
        aria-hidden
        size={size}
        strokeWidth={2}
        color={disabled ? t.controlFgDisabled : t.foreground}
      />
    </Pressable>
  );
}
