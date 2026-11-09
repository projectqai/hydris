import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { cn } from "../lib/utils";

const PANEL_MS = 200;

const PANEL_TRANSITION =
  "[transition:height_200ms_cubic-bezier(0.25,0.46,0.45,0.94),opacity_200ms_cubic-bezier(0,0,0.2,1)]";

type FrameProps = { className?: string; children: ReactNode };

type OpenProps = { open: boolean; children: ReactNode };

type Phase = "rest" | "pin" | "run";

export function MotionRoot({ className, children }: FrameProps) {
  return <View className={cn("[contain:layout_style]", className)}>{children}</View>;
}

export function MotionItem({ className, children }: FrameProps) {
  return <View className={className}>{children}</View>;
}

export function MotionIndicator({ open, children }: OpenProps) {
  return (
    <View
      className={cn(
        "transition-transform duration-[250ms] motion-reduce:transition-none",
        open && "rotate-90",
      )}
    >
      {children}
    </View>
  );
}

// CSS cannot transition from an automatic height, so a press pins the measured height for one
// frame, runs the transition, then returns to an automatic height.
export function MotionPanel({ open, children }: OpenProps) {
  const [mounted, setMounted] = useState(open);
  const [measured, setMeasured] = useState(0);
  const [lastOpen, setLastOpen] = useState(open);
  const [phase, setPhase] = useState<Phase>("rest");

  if (open && !mounted) setMounted(true);

  if (open !== lastOpen) {
    setLastOpen(open);
    setPhase(phase === "rest" ? "pin" : "run");
  }

  useEffect(() => {
    if (phase === "pin") {
      const frame = requestAnimationFrame(() => setPhase("run"));

      return () => cancelAnimationFrame(frame);
    }

    if (phase === "run") {
      const timer = setTimeout(() => {
        setPhase("rest");

        if (!open) setMounted(false);
      }, PANEL_MS);

      return () => clearTimeout(timer);
    }
  }, [phase, open]);

  if (!mounted) return null;

  const pinned = open ? 0 : measured;
  const target = open ? measured : 0;
  const height = phase === "rest" ? undefined : phase === "pin" ? pinned : target;
  const opacity = phase === "pin" ? (open ? 0 : 1) : open ? 1 : 0;

  return (
    <View
      className={cn(
        "overflow-hidden motion-reduce:transition-none",
        phase !== "rest" && PANEL_TRANSITION,
        phase !== "rest" && "will-change-[height,opacity]",
      )}
      style={{ height, opacity }}
    >
      <View onLayout={(event) => setMeasured(event.nativeEvent.layout.height)}>{children}</View>
    </View>
  );
}
