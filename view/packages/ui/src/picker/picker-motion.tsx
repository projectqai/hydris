import type { ReactNode } from "react";

export type HighlightLook = "confirming" | "pending";

export type MotionRootProps = {
  className: string;
  current: string | undefined;
  expanded: boolean;
  highlight: { value: string; look: HighlightLook; cover?: ReactNode } | undefined;
  onPressOutside: (() => void) | undefined;
  onEscape: () => void;
  children: ReactNode;
};

export type MotionItemProps = {
  value: string;
  index: number;
  current: boolean;
  shakes: number;
  children: ReactNode;
};

export const OPENS_IN_MODAL: boolean = false;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionRoot(props: MotionRootProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MotionItem(props: MotionItemProps): ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}
