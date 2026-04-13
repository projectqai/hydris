"use no memo";

import { useState } from "react";
import { Pressable, View } from "react-native";

import { useThemeColors } from "./lib/theme";

export function ActionButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: React.ComponentType<{ size: number; strokeWidth: number; color: string }>;
  label: string;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const [hovered, setHovered] = useState(false);

  return (
    <View>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        aria-label={label}
        hitSlop={6}
        className="hover:bg-glass-hover active:bg-surface-overlay/12 rounded p-1"
      >
        <Icon
          aria-hidden
          size={14}
          strokeWidth={1.5}
          color={hovered ? t.iconStrong : t.iconSubtle}
        />
      </Pressable>
    </View>
  );
}
