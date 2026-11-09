import type { ReactNode } from "react";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const INDICATOR_TIMING = {
  duration: 250,
  easing: Easing.bezier(0.4, 0, 0.2, 1),
  reduceMotion: ReduceMotion.System,
};

const STYLES = StyleSheet.create({ fill: { flex: 1 } });

type IndicatorProps = { value: number; children: ReactNode };

export function MotionIndicator({ value, children }: IndicatorProps) {
  const current = useSharedValue(value);

  useEffect(() => {
    current.set(withTiming(value, INDICATOR_TIMING));
  }, [value, current]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: `${current.get() - 100}%` }],
  }));

  return <Animated.View style={[STYLES.fill, style]}>{children}</Animated.View>;
}
