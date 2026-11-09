import { useEffect, useRef } from "react";
import { View } from "react-native";

import type { PulseLayerProps, PulseLook, ShakeFrameProps } from "./hold-motion";
import { prefersReducedMotion } from "./lib/reduced-motion";
import { cn } from "./lib/utils";
import { usePressOutside } from "./press-outside";

const SHAKE_KEYFRAMES = [
  { transform: "translateX(0)" },
  { transform: "translateX(-4px)" },
  { transform: "translateX(4px)" },
  { transform: "translateX(-3px)" },
  { transform: "translateX(3px)" },
  { transform: "translateX(0)" },
];

const SHAKE_MS = 300;

type Pulse = Parameters<HTMLElement["animate"]>;

const PULSES: Record<PulseLook, { layer: string; resting: number; pulse: Pulse }> = {
  confirming: {
    layer: "bg-background",
    resting: 0,
    pulse: [
      [{ opacity: 0 }, { opacity: 0.22 }, { opacity: 0 }],
      { duration: 1600, iterations: 5, easing: "ease-in-out" },
    ],
  },
  running: {
    layer: "bg-foreground",
    resting: 0.1,
    pulse: [
      [{ opacity: 0.04 }, { opacity: 0.15 }, { opacity: 0.04 }],
      { duration: 1150, iterations: Infinity, easing: "ease-in-out" },
    ],
  },
};

export function ShakeFrame({ shakes, onPressOutside, children }: ShakeFrameProps) {
  const frame = useRef<View>(null);
  const shaken = useRef(shakes);

  usePressOutside(frame, onPressOutside);

  useEffect(() => {
    const node = frame.current;

    if (shakes === shaken.current || !(node instanceof HTMLElement)) return;

    shaken.current = shakes;

    if (prefersReducedMotion()) return;

    node.animate(SHAKE_KEYFRAMES, { duration: SHAKE_MS, easing: "ease-out" });
  }, [shakes]);

  return <View ref={frame}>{children}</View>;
}

export function PulseLayer({ look, className }: PulseLayerProps) {
  const layer = useRef<View>(null);
  const { layer: color, resting, pulse } = PULSES[look];

  useEffect(() => {
    const element = layer.current;

    if (!(element instanceof HTMLElement) || prefersReducedMotion()) return;

    const animation = element.animate(...pulse);

    return () => animation.cancel();
  }, [pulse]);

  return (
    <View
      ref={layer}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", color, className)}
      style={{ opacity: resting }}
    />
  );
}
