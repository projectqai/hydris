import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useFieldControl } from "../field";
import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

const TRACK_W = 56;
const TRACK_H = 28;
const HANDLE = 20;
const PAD = 4;
const BORDER = 1;
const TRAVEL = TRACK_W - HANDLE - (PAD + BORDER) * 2;

export type ToggleSwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  readOnly?: boolean;
};

export function ToggleSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  readOnly,
}: ToggleSwitchProps) {
  const t = useThemeColors();
  const offset = useSharedValue(value ? TRAVEL : 0);
  const editable = !readOnly;
  const toggle = () => onValueChange(!value);

  useFieldControl({ activate: toggle, editable });

  useEffect(() => {
    offset.value = withTiming(value ? TRAVEL : 0, { duration: 180 });
  }, [value, offset]);

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const glow = value ? { boxShadow: `0 0 8px ${t.activeGreenGlow}` } : undefined;

  return (
    <Pressable
      onPress={editable ? toggle : undefined}
      accessibilityRole="switch"
      aria-checked={value}
      accessibilityLabel={accessibilityLabel}
      tabIndex={0}
      className="cursor-default"
    >
      <View
        className={cn(
          "justify-center overflow-hidden rounded-full border",
          value && "bg-active-green border-active-green",
        )}
        style={{
          width: TRACK_W,
          height: TRACK_H,
          paddingHorizontal: PAD,
          ...glow,
          ...(value
            ? undefined
            : { backgroundColor: t.switchTrackBg, borderColor: t.switchTrackBorder }),
        }}
      >
        <LinearGradient
          colors={[value ? t.surfaceInsetSelected : t.switchTrackInset, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          className="pointer-events-none absolute inset-x-0 top-0 h-3/5"
        />
        <Animated.View
          style={[
            {
              width: HANDLE,
              height: HANDLE,
              borderRadius: HANDLE / 2,
              boxShadow: "0 2px 4px rgba(0,0,0,0.35)",
            },
            handleStyle,
          ]}
        >
          <LinearGradient
            colors={value ? t.controlTrackOn : t.controlTrackOff}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              width: HANDLE,
              height: HANDLE,
              borderRadius: HANDLE / 2,
              overflow: "hidden",
            }}
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}
