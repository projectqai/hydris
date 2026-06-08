import type { WidgetScale } from "@hydris/ui/lib/widget-scale";
import { createContext, useContext } from "react";

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

export const ScaleContext = createContext<WidgetScale>({
  hero: 1,
  body: 1,
  element: 1,
  padding: 1,
});

export function useWidgetScale(): WidgetScale {
  return useContext(ScaleContext);
}
