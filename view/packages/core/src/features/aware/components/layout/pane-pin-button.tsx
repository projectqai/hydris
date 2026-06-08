import { useThemeColors } from "@hydris/ui/lib/theme";
import { Pin } from "lucide-react-native";
import { Pressable } from "react-native";

export function PinButton({
  pinned,
  onPress,
  size = 16,
  color,
}: {
  pinned: boolean;
  onPress: () => void;
  size?: number;
  color?: string;
}) {
  const t = useThemeColors();
  const activeColor = color ?? t.controlFgActive;
  return (
    <Pressable
      onPress={onPress}
      aria-label={pinned ? "Change pinned entity" : "Pin an entity"}
      hitSlop={{ top: 10, right: 10, bottom: 6, left: 4 }}
      className="hover:bg-glass-hover active:bg-surface-overlay/12 -m-1 rounded p-1"
    >
      <Pin
        aria-hidden
        size={pinned ? size - 2 : size}
        strokeWidth={pinned ? 1.5 : 2}
        fill={pinned ? activeColor : "none"}
        color={pinned ? activeColor : t.iconMuted}
      />
    </Pressable>
  );
}
