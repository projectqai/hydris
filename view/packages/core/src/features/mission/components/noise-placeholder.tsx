import { useEffect } from "react";
import type { ImageSourcePropType } from "react-native";
import { Image, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const FRAMES: { key: string; source: ImageSourcePropType }[] = [
  { key: "noise-1", source: require("../assets/noise-1.png") },
  { key: "noise-2", source: require("../assets/noise-2.png") },
  { key: "noise-3", source: require("../assets/noise-3.png") },
  { key: "noise-4", source: require("../assets/noise-4.png") },
];

const FRAME_DURATION = 75;

// web writes a required image's size as inline style, which a class cannot override
const STYLES = StyleSheet.create({ fill: { width: "100%", height: "100%" } });

const frameClock = makeMutable(0);

let runningPlaceholders = 0;

function useFrameClock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    runningPlaceholders += 1;

    if (runningPlaceholders === 1) {
      const cycle = { duration: FRAMES.length * FRAME_DURATION, easing: Easing.linear };

      frameClock.set(withRepeat(withTiming(FRAMES.length, cycle), -1));
    }

    return () => {
      runningPlaceholders -= 1;

      if (runningPlaceholders > 0) return;

      cancelAnimation(frameClock);
      frameClock.set(0);
    };
  }, [enabled]);
}

function NoiseFrame({ source, index }: { source: ImageSourcePropType; index: number }) {
  const visibility = useAnimatedStyle(() => ({
    opacity: Math.floor(frameClock.get()) % FRAMES.length === index ? 1 : 0,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, visibility]}>
      <Image source={source} resizeMode="repeat" style={STYLES.fill} />
    </Animated.View>
  );
}

export function NoisePlaceholder() {
  const reduceMotion = useReducedMotion();

  useFrameClock(!reduceMotion);

  return (
    <View aria-hidden className="absolute inset-0 overflow-hidden rounded opacity-3">
      {reduceMotion ? (
        <Image source={FRAMES[0]!.source} resizeMode="repeat" style={STYLES.fill} />
      ) : (
        FRAMES.map(({ key, source }, index) => (
          <NoiseFrame key={key} source={source} index={index} />
        ))
      )}
    </View>
  );
}
