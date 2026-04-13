import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

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
};

export function ToggleSwitch({ value, onValueChange, accessibilityLabel }: ToggleSwitchProps) {
  const t = useThemeColors();
  const offset = useSharedValue(value ? TRAVEL : 0);

  useEffect(() => {
    offset.value = withTiming(value ? TRAVEL : 0, { duration: 180 });
  }, [value, offset]);

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const glow = value
    ? {
        shadowColor: t.activeGreen,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
      }
    : undefined;

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      tabIndex={0}
      className="cursor-default"
    >
      <View style={{ borderRadius: TRACK_H / 2, ...glow }}>
        <View
          className={cn(
            "justify-center overflow-hidden rounded-full border",
            value && "bg-active-green border-active-green",
          )}
          style={{
            width: TRACK_W,
            height: TRACK_H,
            paddingHorizontal: PAD,
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
                elevation: 6,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.35,
                shadowRadius: 4,
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
      </View>
    </Pressable>
  );
}
