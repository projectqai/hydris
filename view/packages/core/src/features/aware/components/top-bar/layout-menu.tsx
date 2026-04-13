"use no memo";

import { ControlButton } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ChevronDown, Columns3Cog, PanelsTopLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { PRESET_KEYBINDS, PRESETS, Z } from "../../constants";

export function LayoutMenu({
  activePresetId,
  onSelect,
  onCustomize,
}: {
  activePresetId: string;
  onSelect: (id: string) => void;
  onCustomize: () => void;
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const activePreset = PRESETS.find((p) => p.id === activePresetId);

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  const handleCustomize = () => {
    setOpen(false);
    onCustomize();
  };

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onClick);
    };
  }, [open]);

  return (
    <View className="relative" style={{ zIndex: Z.TOPBAR }}>
      <View onPointerDown={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
        <ControlButton
          onPress={() => setOpen((v) => !v)}
          variant={open ? "active" : "default"}
          accessibilityLabel="Layout menu"
          accessibilityState={{ expanded: open }}
        >
          <PanelsTopLeft aria-hidden size={14} strokeWidth={2} color={t.iconDefault} />
          <Text className="font-sans-medium text-13 text-on-surface/75">
            {activePreset?.name ?? "\u2014"}
          </Text>
          <ChevronDown aria-hidden size={12} strokeWidth={2} color={t.iconDefault} />
        </ControlButton>
      </View>

      {open && (
        <Animated.View
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(80)}
          role="menu"
          onPointerDown={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: 6,
            minWidth: 190,
            borderRadius: 6,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.borderSubtle,
            borderTopColor: t.borderMedium,
            borderBottomColor: t.borderFaint,
            zIndex: Z.TOPBAR,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 16 },
            shadowOpacity: 0.6,
            shadowRadius: 40,
            overflow: "hidden",
          }}
        >
          <View className="px-1.5 pt-2.5 pb-1">
            <Text className="text-11 text-on-surface/70 px-2 pb-2 font-mono tracking-[1.5px] uppercase">
              Layout
            </Text>

            <View className="bg-surface-overlay/6 mx-2 mb-1 h-px" />

            {PRESETS.map((preset, i) => {
              const isActive = activePresetId === preset.id;
              return (
                <View key={preset.id}>
                  <Pressable
                    onPress={() => handleSelect(preset.id)}
                    role="menuitem"
                    className={cn(
                      "group flex-row items-center px-2 py-2",
                      Platform.OS !== "web" && "py-3",
                    )}
                  >
                    <View
                      className={cn(
                        "mr-2.5 h-3.5 w-0.5 rounded-sm group-hover:bg-amber-500",
                        isActive ? "bg-amber-500" : "bg-transparent",
                      )}
                    />
                    <Text
                      className={cn(
                        "group-hover:text-on-surface/92 flex-1 font-mono text-xs tracking-[0.8px] uppercase",
                        isActive ? "text-on-surface/92" : "text-on-surface/65",
                      )}
                    >
                      {preset.name}
                    </Text>
                    {Platform.OS === "web" && PRESET_KEYBINDS[preset.id] && (
                      <View className="bg-surface-overlay/6 h-4 items-center justify-center rounded px-1">
                        <Text className="text-11 text-on-surface/70 font-mono leading-none">
                          {PRESET_KEYBINDS[preset.id]}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  {i < PRESETS.length - 1 && <View className="bg-surface-overlay/6 mx-2 h-px" />}
                </View>
              );
            })}
          </View>

          <View className="bg-surface-overlay/6 mx-2 h-px" />

          <View className="p-1.5">
            <ControlButton
              onPress={handleCustomize}
              size="sm"
              fullWidth
              accessibilityLabel="Customize layout"
            >
              <Columns3Cog aria-hidden size={11} strokeWidth={2} color={t.iconDefault} />
              <Text className="text-11 text-on-surface/65 font-mono tracking-[0.8px] uppercase">
                Customize
              </Text>
            </ControlButton>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
