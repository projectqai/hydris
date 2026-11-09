import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { PulseLayerProps, PulseLook, ShakeFrameProps } from "./hold-motion";
import { cn } from "./lib/utils";
import { usePressOutside } from "./press-outside";

const SHAKE_STEP = { duration: 50 };

const PULSE_EASING = Easing.inOut(Easing.ease);

// A negative count repeats until the look changes
const PULSES: Record<
  PulseLook,
  { layer: string; resting: number; low: number; high: number; halfMs: number; count: number }
> = {
  confirming: { layer: "bg-background", resting: 0, low: 0, high: 0.22, halfMs: 800, count: 5 },
  running: { layer: "bg-foreground", resting: 0.1, low: 0.04, high: 0.15, halfMs: 575, count: -1 },
};

const STYLES = StyleSheet.create({
  pulse: { pointerEvents: "none" },
});

export function ShakeFrame({ shakes, onPressOutside, children }: ShakeFrameProps) {
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const shaken = useRef(shakes);
  const frame = useRef<View>(null);
  const target = usePressOutside(frame, onPressOutside);

  useEffect(() => {
    if (shakes === shaken.current) return;

    shaken.current = shakes;

    if (reduced) return;

    offset.set(
      withSequence(
        withTiming(-4, SHAKE_STEP),
        withTiming(4, SHAKE_STEP),
        withTiming(-3, SHAKE_STEP),
        withTiming(3, SHAKE_STEP),
        withTiming(0, SHAKE_STEP),
      ),
    );
  }, [shakes, reduced, offset]);

  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  return (
    <Animated.View ref={frame} style={shake} {...target}>
      {children}
    </Animated.View>
  );
}

export function PulseLayer({ look, className }: PulseLayerProps) {
  const reduced = useReducedMotion();
  const { layer, resting, low, high, halfMs, count } = PULSES[look];
  const opacity = useSharedValue(resting);

  useEffect(() => {
    if (reduced) {
      opacity.set(resting);

      return;
    }

    const step = { duration: halfMs, easing: PULSE_EASING };

    opacity.set(withRepeat(withSequence(withTiming(high, step), withTiming(low, step)), count));
  }, [reduced, resting, low, high, halfMs, count, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, STYLES.pulse, style]}>
      <View className={cn("flex-1", layer, className)} />
    </Animated.View>
  );
}
