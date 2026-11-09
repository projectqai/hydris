import type { ReactNode } from "react";
import { View } from "react-native";

type IndicatorProps = { value: number; children: ReactNode };

export function MotionIndicator({ value, children }: IndicatorProps) {
  return (
    <View
      className="flex-1 transition-transform duration-[250ms] motion-reduce:transition-none"
      style={{ transform: [{ translateX: `${value - 100}%` }] }}
    >
      {children}
    </View>
  );
}
