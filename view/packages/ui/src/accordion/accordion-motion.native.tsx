import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { SETTLED_SPRING } from "../lib/spring";

const LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(SETTLED_SPRING.damping)
  .stiffness(SETTLED_SPRING.stiffness)
  .mass(SETTLED_SPRING.mass)
  .reduceMotion(ReduceMotion.System);

const PANEL_ENTERING = FadeIn.duration(200)
  .easing(Easing.out(Easing.ease))
  .reduceMotion(ReduceMotion.System);

const PANEL_EXITING = FadeOut.duration(200)
  .easing(Easing.in(Easing.ease))
  .reduceMotion(ReduceMotion.System);

const INDICATOR_SPRING = {
  damping: 140,
  stiffness: 1000,
  mass: 4,
  reduceMotion: ReduceMotion.System,
};

const STYLES = StyleSheet.create({ clip: { overflow: "hidden" } });

type FrameProps = { className?: string; children: ReactNode };

type OpenProps = { open: boolean; children: ReactNode };

function LayoutFrame({ className, children }: FrameProps) {
  return (
    <Animated.View layout={LAYOUT_TRANSITION} style={STYLES.clip}>
      <View className={className}>{children}</View>
    </Animated.View>
  );
}

export const MotionRoot = LayoutFrame;

export const MotionItem = LayoutFrame;

export function MotionIndicator({ open, children }: OpenProps) {
  const rotation = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    rotation.set(withSpring(open ? 1 : 0, INDICATOR_SPRING));
  }, [open, rotation]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(rotation.get(), [0, 1], [0, 90])}deg` }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

export function MotionPanel({ open, children }: OpenProps) {
  const [skipEnter, setSkipEnter] = useState(open);

  if (!open && skipEnter) setSkipEnter(false);

  if (!open) return null;

  return (
    <Animated.View entering={skipEnter ? undefined : PANEL_ENTERING} exiting={PANEL_EXITING}>
      {children}
    </Animated.View>
  );
}
