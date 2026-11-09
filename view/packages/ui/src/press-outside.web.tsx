import { type ReactNode, type RefObject, useEffect, useEffectEvent } from "react";
import type { View } from "react-native";

import type { PressOutsideTarget } from "./press-outside";

export function PressOutsideRoot({ children }: { children: ReactNode }) {
  return children;
}

export function usePressOutside(
  node: RefObject<View | null>,
  onPressOutside: (() => void) | undefined,
): PressOutsideTarget {
  const listening = onPressOutside !== undefined;
  const pressOutside = useEffectEvent(() => onPressOutside?.());

  useEffect(() => {
    const element = node.current;

    if (!listening || !(element instanceof HTMLElement)) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) pressOutside();
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [node, listening]);

  return {};
}
