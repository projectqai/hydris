import { createContext, useContext } from "react";

const REFERENCE_SIZE = 300;

export type WidgetScale = {
  hero: number;
  body: number;
  element: number;
  padding: number;
};

export const BASE = {
  padding: 12,
  heroText: 48,
  valueText: 18,
  labelText: 14,
  bodyText: 16,
  smallText: 13,
  captionText: 16,
  barHeight: 16,
  barGap: 3,
  rowGap: 8,
  sectionGap: 4,
} as const;

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

export const ScaleContext = createContext<WidgetScale>({
  hero: 1,
  body: 1,
  element: 1,
  padding: 1,
});

export function useWidgetScale(): WidgetScale {
  return useContext(ScaleContext);
}
