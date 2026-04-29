"use no memo";

import { ControlButton, ControlIconButton } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { CommandTrigger } from "@hydris/ui/top-bar/command-trigger";
import { CustomizeHelpIcon } from "@hydris/ui/top-bar/customize-help-icon";
import { PlacementHelpIcon } from "@hydris/ui/top-bar/placement-help-icon";
import { Bell, Undo2, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
} from "react-native-reanimated";

import { Z } from "../../constants";
import { ContextStrip } from "./context-strip";
import { LayoutMenu } from "./layout-menu";
import { PresetStrip } from "./preset-strip";

type PlacementMode = {
  progress: SharedValue<number>;
  isActive: boolean;
  onConfirm: () => void;
  onAbort: () => void;
};

export function TopBar({
  activePresetId,
  onPresetSelect,
  customizeProgress,
  isCustomizing,
  onCustomize,
  onDone,
  isLayoutModified,
  onResetToPreset,
  onOpenPalette,
  commandButtonRight,
  isScreenLocked,
  placement,
}: {
  activePresetId: string;
  onPresetSelect: (id: string) => void;
  customizeProgress: SharedValue<number>;
  isCustomizing: boolean;
  onCustomize: () => void;
  onDone: () => void;
  isLayoutModified: boolean;
  onResetToPreset: () => void;
  onOpenPalette: () => void;
  commandButtonRight?: boolean;
  isScreenLocked: boolean;
  placement: PlacementMode;
}) {
  const t = useThemeColors();

  const modeProgress = useDerivedValue(() =>
    Math.max(customizeProgress.value, placement.progress.value),
  );

  const containerStyle = useAnimatedStyle(() => {
    const cp = customizeProgress.value;
    const pp = placement.progress.value;
    const bg =
      pp > cp
        ? interpolateColor(pp, [0, 1], [t.topBarBg, t.topBarPlacementBg])
        : interpolateColor(cp, [0, 1], [t.topBarBg, t.topBarCustomizeBg]);
    const border =
      pp > cp
        ? interpolateColor(pp, [0, 1], [t.topBarBorderBottom, t.placementAccentSubtle])
        : interpolateColor(cp, [0, 1], [t.topBarBorderBottom, t.customizeAccentSubtle]);
    return { backgroundColor: bg, borderBottomColor: border };
  });

  const operateStyle = useAnimatedStyle(() => ({
    opacity: interpolate(modeProgress.value, [0, 0.4], [1, 0], "clamp"),
    transform: [{ translateY: interpolate(modeProgress.value, [0, 0.4], [0, -8], "clamp") }],
  }));

  const customizeBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(customizeProgress.value, [0.5, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(customizeProgress.value, [0.5, 1], [8, 0], "clamp") }],
  }));

  const placementBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(placement.progress.value, [0.5, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(placement.progress.value, [0.5, 1], [8, 0], "clamp") }],
  }));

  return (
    <Animated.View
      style={[
        {
          borderBottomWidth: 1,
          borderTopWidth: 1,
          borderTopColor: t.borderFaint,
          zIndex: Z.TOPBAR,
          // @ts-ignore react-native-web CSS property
          userSelect: "none",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.35,
          shadowRadius: 6,
        },
        containerStyle,
      ]}
    >
      <Animated.View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            position: isCustomizing || placement.isActive ? "absolute" : "relative",
            left: 0,
            right: 0,
          },
          operateStyle,
        ]}
        pointerEvents={isCustomizing || placement.isActive ? "none" : "auto"}
      >
        <View className="flex-1" pointerEvents={isScreenLocked ? "none" : "auto"}>
          <ContextStrip />
        </View>
        {!commandButtonRight && <CommandTrigger onPress={onOpenPalette} />}
        <View className="flex-1 flex-row items-center justify-end gap-1.5">
          {commandButtonRight && <CommandTrigger onPress={onOpenPalette} />}
          <View
            className="flex-row items-center gap-1.5"
            pointerEvents={isScreenLocked ? "none" : "auto"}
          >
            <LayoutMenu
              activePresetId={activePresetId}
              onSelect={onPresetSelect}
              onCustomize={onCustomize}
            />
            <ControlIconButton
              icon={Bell}
              onPress={() => {}}
              size="md"
              accessibilityLabel="Notifications"
              disabled
            />
          </View>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            position: isCustomizing ? "relative" : "absolute",
            left: 0,
            right: 0,
          },
          customizeBarStyle,
        ]}
        pointerEvents={isCustomizing ? "auto" : "none"}
      >
        <View className="flex-1 flex-row items-center gap-1.5">
          <View className="size-1.5 rounded-full" style={{ backgroundColor: t.customizeAccent }} />
          <Text className="font-sans-medium text-11" style={{ color: t.customizeAccent }}>
            Editing Layout
          </Text>
          <CustomizeHelpIcon />
        </View>
        <PresetStrip activePresetId={activePresetId} onSelect={onPresetSelect} />
        <View className="flex-1 flex-row justify-end gap-1.5">
          {isLayoutModified && (
            <Pressable
              onPress={onResetToPreset}
              aria-label="Reset to preset"
              className="h-9 flex-row items-center justify-center gap-1 rounded-md border px-2.5"
              style={{ borderColor: t.customizeAccentSubtle }}
            >
              <Undo2 aria-hidden size={12} color={t.customizeAccent} />
              <Text className="font-sans-medium text-11" style={{ color: t.customizeAccent }}>
                Reset
              </Text>
            </Pressable>
          )}
          <ControlButton
            onPress={onDone}
            label="Done"
            variant="success"
            labelClassName="font-sans-semibold text-11"
            accessibilityLabel="Exit layout editing"
          />
        </View>
      </Animated.View>

      <Animated.View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            position: placement.isActive ? "relative" : "absolute",
            left: 0,
            right: 0,
          },
          placementBarStyle,
        ]}
        pointerEvents={placement.isActive ? "auto" : "none"}
      >
        <View className="flex-1 flex-row items-center gap-1.5">
          <View className="size-1.5 rounded-full" style={{ backgroundColor: t.placementAccent }} />
          <Text className="font-sans-medium text-11" style={{ color: t.placementAccent }}>
            Set position
          </Text>
          <PlacementHelpIcon />
        </View>
        <View className="flex-1 flex-row justify-end gap-1.5">
          <ControlButton
            onPress={placement.onAbort}
            icon={X}
            label="Cancel"
            variant="destructive"
            size="md"
            labelClassName="font-sans-semibold text-11"
            accessibilityLabel="Cancel placement"
          />
          <ControlButton
            onPress={placement.onConfirm}
            label="Confirm"
            variant="success"
            labelClassName="font-sans-semibold text-11"
            accessibilityLabel="Confirm sensor placement"
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
