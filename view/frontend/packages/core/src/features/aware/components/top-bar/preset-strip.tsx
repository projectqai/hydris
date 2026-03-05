"use no memo";

import { cn } from "@hydris/ui/lib/utils";
import { Pressable, Text, View } from "react-native";

import { PRESETS } from "../../constants";

// Web-only CSS shadows — React Native doesn't support boxShadow/inset
const INSET_SHADOW = "inset 0 1px 3px rgba(0,0,0,0.45)";
const ACTIVE_SHADOW = "0 1px 2px rgba(0,0,0,0.3)";

export function PresetStrip({
  activePresetId,
  onSelect,
}: {
  activePresetId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View
      role="tablist"
      className="flex-row gap-0.5 rounded border border-black/30 border-b-white/8 bg-black/35 p-1"
      style={{
        // @ts-ignore react-native-web CSS property
        boxShadow: INSET_SHADOW,
      }}
    >
      {PRESETS.map((preset) => {
        const isActive = activePresetId === preset.id;
        return (
          <Pressable
            key={preset.id}
            onPress={() => onSelect(preset.id)}
            role="tab"
            aria-selected={isActive}
            aria-label={
              isActive ? `${preset.name} layout (active)` : `Switch to ${preset.name} layout`
            }
            className={cn(
              "items-center justify-center rounded border border-transparent px-3 py-1.5 hover:bg-white/5",
              isActive && "border-white/8 bg-white/10",
            )}
            style={
              isActive
                ? {
                    // @ts-ignore react-native-web CSS property
                    boxShadow: ACTIVE_SHADOW,
                  }
                : undefined
            }
          >
            <Text
              className={cn(
                "font-sans-medium text-13",
                isActive ? "text-white/92" : "text-white/65",
              )}
            >
              {preset.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
