import type { ReactNode } from "react";

type FrameProps = { className?: string; children: ReactNode };

type OpenProps = { open: boolean; children: ReactNode };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionRoot(props: FrameProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionItem(props: FrameProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionIndicator(props: OpenProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionPanel(props: OpenProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}
