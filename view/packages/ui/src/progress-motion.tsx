import type { ReactNode } from "react";

type IndicatorProps = { value: number; children: ReactNode };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionIndicator(props: IndicatorProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}
