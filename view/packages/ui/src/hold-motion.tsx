import type { ReactNode } from "react";

export type PulseLook = "confirming" | "running";

export type ShakeFrameProps = {
  shakes: number;
  onPressOutside?: () => void;
  children: ReactNode;
};

export type PulseLayerProps = { look: PulseLook; className?: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ShakeFrame(props: ShakeFrameProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PulseLayer(props: PulseLayerProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}
