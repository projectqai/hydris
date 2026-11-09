import type { ReactNode } from "react";
import type { SharedValue } from "react-native-reanimated";

export type HoldFillProps = {
  holding: boolean;
  duration: number;
  // Web only. On Android the fill follows progress, which the hold hook releases.
  releaseMs?: number;
  progress: SharedValue<number>;
  className?: string;
  children?: ReactNode;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function HoldFill(props: HoldFillProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}
