import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { THUMB_SIZE } from "../controls/control-slider";
import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

const TRACK_HEIGHT = 6;
const THUMB_RADIUS = THUMB_SIZE / 2;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

export type ScrubberProps = {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  disabled?: boolean;
};

export function Scrubber({
  position,
  duration,
  onSeek,
  onSeekStart,
  onSeekEnd,
  disabled,
}: ScrubberProps) {
  const t = useThemeColors();
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safePosition = Number.isFinite(position) ? clamp(position, 0, safeDuration) : 0;
  const trackWidth = useSharedValue(0);
  const thumbRatio = useSharedValue(safeDuration > 0 ? safePosition / safeDuration : 0);
  const startRatio = useSharedValue(0);
  const isScrubbing = useSharedValue(false);
  const thumbScale = useSharedValue(1);
  const tapActive = useSharedValue(false);
  const pendingSeekRatio = useSharedValue(-1);
  const [, setMeasured] = useState(false);
  const handlersRef = useRef({ duration: safeDuration, onSeek, onSeekStart, onSeekEnd });

  useEffect(() => {
    handlersRef.current = { duration: safeDuration, onSeek, onSeekStart, onSeekEnd };
  }, [onSeek, onSeekEnd, onSeekStart, safeDuration]);

  useDerivedValue(() => {
    if (safeDuration <= 0 || trackWidth.value <= 0) return;
    const positionRatio = safePosition / safeDuration;
    if (isScrubbing.value) {
      if (
        pendingSeekRatio.value >= 0 &&
        Math.abs(positionRatio - pendingSeekRatio.value) < 0.0001
      ) {
        pendingSeekRatio.value = -1;
        isScrubbing.value = false;
      }
      return;
    }
    thumbRatio.value = positionRatio;
  });

  const reportSeek = useCallback((ratio: number) => {
    const { duration: latestDuration, onSeek: seek } = handlersRef.current;
    seek(ratio * latestDuration);
  }, []);

  const reportSeekStart = useCallback(() => {
    handlersRef.current.onSeekStart();
  }, []);

  const reportSeekEnd = useCallback(() => {
    handlersRef.current.onSeekEnd();
  }, []);

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      trackWidth.value = event.nativeEvent.layout.width;
      setMeasured(true);
    },
    [trackWidth],
  );

  const composedGesture = useMemo(() => {
    const panGesture = Gesture.Pan()
      .enabled(!disabled && safeDuration > 0)
      .hitSlop({ top: 12, bottom: 12 })
      .minDistance(0)
      .onBegin(() => {
        isScrubbing.value = true;
        pendingSeekRatio.value = -1;
        thumbScale.value = withTiming(1.2, { reduceMotion: ReduceMotion.System });
        startRatio.value = thumbRatio.value;
        scheduleOnRN(reportSeekStart);
      })
      .onUpdate((event) => {
        "worklet";
        const travel = trackWidth.value - THUMB_SIZE;
        if (travel <= 0) return;
        const ratio = clamp(startRatio.value + event.translationX / travel, 0, 1);
        thumbRatio.value = ratio;
        scheduleOnRN(reportSeek, ratio);
      })
      .onEnd((_event, success) => {
        "worklet";
        if (!success) return;
        pendingSeekRatio.value = thumbRatio.value;
        thumbScale.value = withTiming(1, { reduceMotion: ReduceMotion.System });
        scheduleOnRN(reportSeek, thumbRatio.value);
        scheduleOnRN(reportSeekEnd);
      })
      .onFinalize((_event, success) => {
        "worklet";
        if (success || !isScrubbing.value) return;
        pendingSeekRatio.value = -1;
        isScrubbing.value = false;
        thumbScale.value = withTiming(1, { reduceMotion: ReduceMotion.System });
        scheduleOnRN(reportSeekEnd);
      });

    const tapGesture = Gesture.Tap()
      .enabled(!disabled && safeDuration > 0)
      .onStart(() => {
        tapActive.value = true;
        isScrubbing.value = true;
        pendingSeekRatio.value = -1;
        scheduleOnRN(reportSeekStart);
      })
      .onEnd((event) => {
        "worklet";
        const travel = trackWidth.value - THUMB_SIZE;
        if (travel <= 0) return;
        const ratio = clamp((event.x - THUMB_RADIUS) / travel, 0, 1);
        thumbRatio.value = ratio;
        pendingSeekRatio.value = ratio;
        scheduleOnRN(reportSeek, ratio);
      })
      .onFinalize((_event, success) => {
        "worklet";
        if (!tapActive.value) return;
        tapActive.value = false;
        if (!success) {
          pendingSeekRatio.value = -1;
          isScrubbing.value = false;
        }
        scheduleOnRN(reportSeekEnd);
      });

    return Gesture.Race(panGesture, tapGesture);
  }, [
    disabled,
    isScrubbing,
    pendingSeekRatio,
    reportSeek,
    reportSeekEnd,
    reportSeekStart,
    safeDuration,
    startRatio,
    tapActive,
    thumbRatio,
    thumbScale,
    trackWidth,
  ]);

  const playedStyle = useAnimatedStyle(() => {
    const travel = Math.max(trackWidth.value - THUMB_SIZE, 0);
    return { width: THUMB_RADIUS + thumbRatio.value * travel };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const travel = Math.max(trackWidth.value - THUMB_SIZE, 0);
    return {
      transform: [{ translateX: thumbRatio.value * travel }, { scale: thumbScale.value }],
    };
  });

  return (
    <View
      className={cn(disabled && "cursor-not-allowed opacity-60")}
      accessibilityRole="adjustable"
      accessibilityLabel="Media playback position"
      aria-disabled={!!disabled}
      aria-valuemin={0}
      aria-valuemax={safeDuration}
      aria-valuenow={safePosition}
    >
      <GestureDetector gesture={composedGesture}>
        <View
          className={cn(
            "h-6 touch-manipulation justify-center select-none",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <View onLayout={handleLayout} className="h-6 justify-center">
            <View
              className="overflow-hidden rounded-full border"
              style={{
                height: TRACK_HEIGHT,
                backgroundColor: t.insetBg,
                borderColor: t.insetBorder,
                borderTopColor: t.insetHighlight,
                boxShadow: t.insetShadow,
              }}
            >
              <Animated.View
                style={[
                  {
                    height: TRACK_HEIGHT,
                    backgroundColor: t.iconActive,
                  },
                  playedStyle,
                ]}
              />
            </View>

            <Animated.View
              style={[
                {
                  position: "absolute",
                  left: 0,
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  borderRadius: THUMB_RADIUS,
                  boxShadow: t.controlBoxShadow,
                },
                thumbStyle,
              ]}
            >
              <LinearGradient
                colors={disabled ? t.controlTrackOff : t.controlTrackOn}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  borderRadius: THUMB_RADIUS,
                }}
              />
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}
