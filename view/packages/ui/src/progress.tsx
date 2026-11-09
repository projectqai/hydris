import type { ComponentProps } from "react";
import { createContext, use } from "react";
import { View } from "react-native";

import { cn } from "./lib/utils";
import { MotionIndicator } from "./progress-motion";

const ProgressContext = createContext<number | null>(null);

function useProgressValue() {
  const value = use(ProgressContext);

  if (value === null) throw new Error("Progress parts must be rendered inside a Progress");

  return value;
}

// React Native has no descendant selectors, so callers compose the track and indicator to style them
export function Progress({
  value,
  children,
  ...props
}: ComponentProps<typeof View> & { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <ProgressContext value={clamped}>
      <View
        accessible
        accessibilityRole="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        {...props}
      >
        {children}
      </View>
    </ProgressContext>
  );
}

export function ProgressTrack({ className, ...props }: ComponentProps<typeof View>) {
  return (
    <View
      className={cn("bg-foreground/20 h-1 overflow-hidden rounded-full", className)}
      {...props}
    />
  );
}

export function ProgressIndicator({ className, ...props }: ComponentProps<typeof View>) {
  const value = useProgressValue();

  return (
    <MotionIndicator value={value}>
      <View className={cn("bg-foreground/70 flex-1 rounded-full", className)} {...props} />
    </MotionIndicator>
  );
}
