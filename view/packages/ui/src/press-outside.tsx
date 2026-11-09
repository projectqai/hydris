import type { ReactNode, RefObject } from "react";
import type { View } from "react-native";

// A press outside a control, which ends a control's wait without taking the press away from what
// it lands on. The root sees every touch, so it wraps the app once.

export type PressOutsideTarget = { onTouchStart?: () => void };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PressOutsideRoot(props: { children: ReactNode }): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}

// Spread the result on the control's view, so its own touches count as inside
export function usePressOutside(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  node: RefObject<View | null>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPressOutside: (() => void) | undefined,
): PressOutsideTarget {
  throw new Error("Platform-specific implementation not loaded");
}
