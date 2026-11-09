import type { LucideIcon } from "lucide-react-native";
import type { ReactNode, Ref } from "react";
import { Pressable, View } from "react-native";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

export function PaletteRow({
  icon: Icon,
  highlighted,
  onPress,
  children,
  ref,
}: {
  icon: LucideIcon;
  highlighted: boolean;
  onPress: () => void;
  children: ReactNode;
  ref?: Ref<View>;
}) {
  const t = useThemeColors();

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      tabIndex={-1}
      className={cn(
        "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
        highlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
      )}
    >
      <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
        <Icon size={16} strokeWidth={2} color={t.iconMuted} />
      </View>
      {children}
    </Pressable>
  );
}
