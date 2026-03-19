import type { ReactNode, Ref } from "react";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, type View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useKeyboardShortcut } from "../keyboard";
import { useThemeColors } from "../lib/theme";

const DEFAULT_DURATION_MS = 2000;
const COUNTDOWN_INTERVAL_MS = 100;

export function HoldToConfirmPressable({
  onConfirm,
  duration = DEFAULT_DURATION_MS,
  isActive = false,
  fillColor,
  fillOpacity = 0.15,
  children,
  className,
  ref,
}: {
  onConfirm: () => void;
  duration?: number;
  isActive?: boolean;
  fillColor?: string;
  fillOpacity?: number;
  children: ReactNode | ((state: { remaining: number | null }) => ReactNode);
  className?: string;
  ref?: Ref<View>;
}) {
  const t = useThemeColors();
  const color = fillColor ?? t.destructiveRed;
  const fillProgress = useSharedValue(0);
  const isPressing = useRef(false);
  const startTime = useRef(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (remaining === null) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - startTime.current;
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left === 0) {
        clearInterval(id);
        confirmedRef.current = true;
        isPressing.current = false;
        setRemaining(null);
        onConfirm();
      }
    }, COUNTDOWN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [remaining !== null, duration, onConfirm]);

  const startFill = () => {
    if (isPressing.current) return;
    isPressing.current = true;
    confirmedRef.current = false;
    startTime.current = Date.now();
    setRemaining(duration);
    fillProgress.set(withTiming(1, { duration }));
  };

  const endFill = () => {
    if (!isPressing.current) return;
    isPressing.current = false;
    setRemaining(null);
    cancelAnimation(fillProgress);
    fillProgress.set(withTiming(0, { duration: 150 }));
  };

  // Cancel fill when row loses active state (e.g. arrow key while holding Enter)
  useEffect(() => {
    if (!isActive && isPressing.current) {
      isPressing.current = false;
      setRemaining(null);
      cancelAnimation(fillProgress);
      fillProgress.set(0);
    }
  }, [isActive, fillProgress]);

  // Keyboard: intercept Enter keydown at higher priority than useListNav (200)
  useKeyboardShortcut(
    "Enter",
    () => {
      if (!isActive) return false;
      startFill();
      return true;
    },
    { priority: 300 },
  );

  // Keyboard: listen for Enter keyup (no keyup in the keyboard shortcut system)
  useEffect(() => {
    if (!isActive || Platform.OS !== "web") return;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Enter") endFill();
    };
    document.addEventListener("keyup", onKeyUp);
    return () => document.removeEventListener("keyup", onKeyUp);
  }, [isActive, endFill]);

  const fillStyle = useAnimatedStyle(() => {
    const progress = fillProgress.get();
    return {
      transform: [{ scaleX: progress }],
      opacity: fillOpacity * (0.4 + 0.6 * progress),
    };
  });

  return (
    <Pressable
      ref={ref}
      onPressIn={startFill}
      onPressOut={endFill}
      tabIndex={-1}
      className={className}
      // @ts-ignore react-native-web CSS property
      style={{ overflow: "hidden", userSelect: "none", cursor: "pointer", position: "relative" }}
    >
      <Animated.View
        style={[
          fillStyle,
          {
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "100%",
            transformOrigin: "left",
            backgroundColor: color,
          },
        ]}
      />
      {typeof children === "function" ? children({ remaining }) : children}
    </Pressable>
  );
}
