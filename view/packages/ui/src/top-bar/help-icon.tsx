"use no memo";

import { Info } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Z } from "../layout/constants";
import { useThemeColors } from "../lib/theme";

export type HelpItem = { key: string; text: string };

export function HelpIcon({
  items,
  label,
  color,
}: {
  items: readonly HelpItem[];
  label: string;
  color: string;
}) {
  const t = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const showTooltip = hovered || focused || pinned;

  return (
    <View className="relative">
      <Pressable
        onPress={() => setPinned((p) => !p)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        role="button"
        aria-label={label}
        aria-expanded={showTooltip}
        hitSlop={8}
        className="p-0.5"
      >
        <Info size={14} strokeWidth={1.5} color={color} />
      </Pressable>
      {showTooltip && (
        <View
          className="border-surface-overlay/8 absolute top-full left-0 mt-2 w-60 rounded-lg border px-3.5 py-2.5"
          style={{
            backgroundColor: t.card,
            zIndex: Z.TOPBAR,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {items.map((item, i) => (
            <View
              key={item.key}
              className="flex-row items-center gap-2 py-1.5"
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: t.borderSubtle } : undefined}
            >
              <View className="bg-surface-overlay/6 h-5 min-w-16 items-center justify-center rounded px-1.5">
                <Text className="font-sans-medium text-10 text-on-surface/70">{item.key}</Text>
              </View>
              <Text className="text-11 text-on-surface/75 flex-1 font-sans">{item.text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
