import { useCallback, useState } from "react";

export type WidgetScale = {
  hero: number;
  body: number;
  element: number;
  padding: number;
};

const REFERENCE_SIZE = 300;

export function computeScale(width: number, height: number): WidgetScale {
  const minDim = Math.min(width, height);
  if (minDim <= 0) return { hero: 1, body: 1, element: 1, padding: 1 };
  const base = minDim / REFERENCE_SIZE;
  return {
    hero: Math.max(0.7, Math.min(1.1, base)),
    body: Math.max(0.7, Math.min(1.0, base * 0.85)),
    element: Math.max(0.7, Math.min(1.05, base * 0.9)),
    padding: Math.max(0.8, Math.min(1.0, base * 0.8)),
  };
}

export function headerIconSize(scale: WidgetScale): number {
  return Math.round(Math.max(12, Math.round(14 * scale.body)) * 1.25);
}

export function useMeasuredScale(): {
  scale: WidgetScale;
  onLayout: (e: { nativeEvent: { layout: { width: number; height: number } } }) => void;
} {
  const [scale, setScale] = useState<WidgetScale>(() => computeScale(0, 0));
  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const next = computeScale(e.nativeEvent.layout.width, e.nativeEvent.layout.height);
      setScale((prev) =>
        prev.hero === next.hero &&
        prev.body === next.body &&
        prev.element === next.element &&
        prev.padding === next.padding
          ? prev
          : next,
      );
    },
    [],
  );
  return { scale, onLayout };
}
