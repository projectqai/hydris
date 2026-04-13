"use no memo";

import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

const TRACK_H = 6;
const THUMB_SIZE = 24;
const THUMB_RADIUS = THUMB_SIZE / 2;

function clamp(val: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(val, lo), hi);
}

function snap(val: number, min: number, step: number): number {
  "worklet";
  return min + Math.round((val - min) / step) * step;
}

export type ControlSliderProps = {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  readOnly?: boolean;
  accessibilityLabel: string;
};

export function ControlSlider({
  value,
  onValueChange,
  min,
  max,
  step,
  unit,
  readOnly,
  accessibilityLabel,
}: ControlSliderProps) {
  const t = useThemeColors();
  const range = max - min || 1;
  const trackWidth = useSharedValue(0);
  const thumbRatio = useSharedValue(clamp((value - min) / range, 0, 1));
  const startRatio = useSharedValue(0);
  const [, setMeasured] = useState(false);

  const thumbGradient = readOnly ? t.controlTrackOff : t.controlTrackOn;

  useEffect(() => {
    thumbRatio.value = clamp((value - min) / range, 0, 1);
  }, [value, min, range, thumbRatio]);

  const reportValue = useCallback(
    (ratio: number) => {
      const raw = min + ratio * range;
      const snapped = Math.min(snap(raw, min, step), max);
      onValueChange(Math.round(snapped * 1e10) / 1e10);
    },
    [min, max, range, step, onValueChange],
  );

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      trackWidth.value = e.nativeEvent.layout.width;
      setMeasured(true);
    },
    [trackWidth],
  );

  const panGesture = Gesture.Pan()
    .enabled(!readOnly)
    .hitSlop({ top: 12, bottom: 12 })
    .minDistance(0)
    .onStart(() => {
      startRatio.value = thumbRatio.value;
    })
    .onUpdate((e) => {
      "worklet";
      const travel = trackWidth.value - THUMB_SIZE;
      if (travel <= 0) return;
      const delta = e.translationX / travel;
      const rawRatio = clamp(startRatio.value + delta, 0, 1);
      const rawVal = min + rawRatio * (max - min);
      const snapped = clamp(snap(rawVal, min, step), min, max);
      thumbRatio.value = clamp((snapped - min) / (max - min), 0, 1);
    })
    .onEnd(() => {
      "worklet";
      runOnJS(reportValue)(thumbRatio.value);
    });

  const tapGesture = Gesture.Tap()
    .enabled(!readOnly)
    .onEnd((e) => {
      "worklet";
      const travel = trackWidth.value - THUMB_SIZE;
      if (travel <= 0) return;
      const ratio = clamp((e.x - THUMB_RADIUS) / travel, 0, 1);
      const rawVal = min + ratio * (max - min);
      const snapped = clamp(snap(rawVal, min, step), min, max);
      const snappedRatio = clamp((snapped - min) / (max - min), 0, 1);
      thumbRatio.value = snappedRatio;
      runOnJS(reportValue)(snappedRatio);
    });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const filledStyle = useAnimatedStyle(() => ({
    width: `${thumbRatio.value * 100}%`,
  }));

  const thumbStyle = useAnimatedStyle(() => {
    const travel = trackWidth.value - THUMB_SIZE;
    return { transform: [{ translateX: thumbRatio.value * Math.max(travel, 0) }] };
  });

  return (
    <View
      className={cn(readOnly && "cursor-not-allowed opacity-60")}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        min,
        max,
        now: value,
        text: unit ? `${value} ${unit}` : String(value),
      }}
    >
      <View className="mb-2 flex-row justify-between">
        <Text className="text-control-fg-active font-mono text-sm">
          {value}
          {unit ? <Text className="text-control-text-muted text-11"> {unit}</Text> : null}
        </Text>
      </View>

      <GestureDetector gesture={composedGesture}>
        <View
          onLayout={handleLayout}
          className={cn("h-8 justify-center", readOnly ? "cursor-not-allowed" : "cursor-pointer")}
        >
          <View className="bg-control-border h-1.5 overflow-hidden rounded-full">
            <Animated.View
              style={[
                {
                  height: TRACK_H,
                  borderRadius: TRACK_H / 2,
                  backgroundColor: t.activeGreen,
                },
                filledStyle,
              ]}
            />
          </View>

          <Animated.View
            style={[
              {
                position: "absolute",
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: THUMB_RADIUS,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.5,
                shadowRadius: 4,
              },
              thumbStyle,
            ]}
          >
            <LinearGradient
              colors={thumbGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              className="size-6 rounded-full"
            />
          </Animated.View>
        </View>
      </GestureDetector>

      <View className="mt-0.5 flex-row justify-between">
        <Text className="text-control-text-muted text-10 font-mono">{min}</Text>
        <Text className="text-control-text-muted text-10 font-mono">{max}</Text>
      </View>
    </View>
  );
}
