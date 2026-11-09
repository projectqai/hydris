import { useEffect, useRef } from "react";
import { View } from "react-native";

import type { HoldFillProps } from "./hold-fill";
import { DEFAULT_RELEASE_MS } from "./hooks/use-hold-to-confirm";
import { prefersReducedMotion } from "./lib/reduced-motion";
import { cn } from "./lib/utils";

function fillTiming(holding: boolean, duration: number, releaseMs: number) {
  if (prefersReducedMotion()) return { duration: 0 };

  if (holding) return { duration, easing: "linear" };

  return { duration: releaseMs, easing: "ease-out" };
}

function insetShare(length: string, width: number) {
  if (length.endsWith("%")) return parseFloat(length) / 100;

  return parseFloat(length) / width;
}

function revealedShare(element: HTMLElement) {
  const inset = /inset\(([^)]*)\)/.exec(getComputedStyle(element).clipPath)?.[1]?.split(" ") ?? [];
  const right = inset[1] ?? inset[0] ?? "100%";

  return 1 - insetShare(right, element.offsetWidth);
}

function clip(share: number) {
  return `inset(0 ${(1 - share) * 100}% 0 0)`;
}

export function HoldFill({
  holding,
  duration,
  releaseMs = DEFAULT_RELEASE_MS,
  className,
  children,
}: HoldFillProps) {
  const fill = useRef<View>(null);

  useEffect(() => {
    const element = fill.current;

    if (!(element instanceof HTMLElement)) return;

    // Read before cancelling, so a release starts where the fill is, not from its resting clip
    const shown = revealedShare(element);

    for (const running of element.getAnimations()) running.cancel();

    if (!holding && shown === 0) return;

    const from = { clipPath: clip(shown), visibility: "visible" };

    // A fully clipped fill still covers the text for contrast checks, so it hides at rest
    const to = { clipPath: clip(holding ? 1 : 0), visibility: holding ? "visible" : "hidden" };

    element.animate([from, to], { ...fillTiming(holding, duration, releaseMs), fill: "forwards" });
  }, [holding, duration, releaseMs]);

  return (
    <View
      ref={fill}
      testID="hold-fill"
      className={cn(
        "pointer-events-none invisible absolute inset-0 [clip-path:inset(0_100%_0_0)]",
        className,
      )}
    >
      {children}
    </View>
  );
}
