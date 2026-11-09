import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Platform } from "react-native";
import { cancelAnimation, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { useKeyboardShortcut } from "../keyboard";

const DEFAULT_DURATION_MS = 2000;
const COUNTDOWN_TICK_MS = 100;
export const DEFAULT_RELEASE_MS = 150;
const PRESS_FEEDBACK_BASELINE = 0.18;

type HoldPhase = "idle" | "holding" | "confirmed";

type HoldReset = "animated" | "instant";

export function useHoldToConfirm({
  onConfirm,
  duration = DEFAULT_DURATION_MS,
  confirmedMs = 0,
  releaseMs = DEFAULT_RELEASE_MS,
  active,
}: {
  onConfirm: () => void;
  duration?: number;
  // How long a completed hold stays full before it confirms
  confirmedMs?: number;
  releaseMs?: number;
  active: boolean;
}) {
  const progress = useSharedValue(0);
  const phase = useRef<HoldPhase>("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const holding = remaining !== null;
  const confirm = useEffectEvent(onConfirm);

  useEffect(() => {
    if (!holding) return;

    const startedAt = Date.now();

    const tick = setInterval(() => {
      setRemaining(Math.max(0, duration - (Date.now() - startedAt)));
    }, COUNTDOWN_TICK_MS);

    let settle: ReturnType<typeof setTimeout> | undefined;

    const done = setTimeout(() => {
      phase.current = "confirmed";
      clearInterval(tick);
      setRemaining(0);

      settle = setTimeout(() => {
        setRemaining(null);
        progress.set(withTiming(0, { duration: releaseMs }));
        confirm();
      }, confirmedMs);
    }, duration);

    return () => {
      clearInterval(tick);
      clearTimeout(done);
      clearTimeout(settle);
    };
  }, [holding, duration, confirmedMs, releaseMs, progress]);

  const onPressIn = () => {
    if (phase.current !== "idle") return;

    phase.current = "holding";
    setRemaining(duration);
    progress.set(
      withSequence(
        withTiming(PRESS_FEEDBACK_BASELINE, { duration: 0 }),
        withTiming(1, { duration }),
      ),
    );
  };

  const cancelHold = useCallback(
    (reset: HoldReset) => {
      const wasHolding = phase.current === "holding";
      phase.current = "idle";

      if (!wasHolding) return;

      setRemaining(null);
      cancelAnimation(progress);
      progress.set(reset === "animated" ? withTiming(0, { duration: releaseMs }) : 0);
    },
    [progress, releaseMs],
  );

  const onPressOut = () => cancelHold("animated");

  useEffect(() => {
    if (!active) cancelHold("instant");
  }, [active, cancelHold]);

  useKeyboardShortcut(
    "Enter",
    () => {
      if (!active) return false;

      onPressIn();

      return true;
    },
    { priority: 300 },
  );

  const releaseEnter = useEffectEvent(onPressOut);

  useEffect(() => {
    if (!active || Platform.OS !== "web") return;

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Enter") releaseEnter();
    };

    document.addEventListener("keyup", onKeyUp);

    return () => document.removeEventListener("keyup", onKeyUp);
  }, [active]);

  return { progress, remaining, onPressIn, onPressOut };
}
