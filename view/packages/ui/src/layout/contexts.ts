import type { ComponentType } from "react";
import { createContext } from "react";

import type { LayoutEditingContextValue, LeafRendererProps, SplitRatioContextValue } from "./types";

export const SplitRatioContext = createContext<SplitRatioContextValue | null>(null);
export const SplitDragContext = createContext<((active: boolean) => void) | null>(null);
export const LayoutEditingContext = createContext<LayoutEditingContextValue | null>(null);
export const LeafRendererContext = createContext<ComponentType<LeafRendererProps> | null>(null);
export const ComponentRegistryContext = createContext<{
  components: Record<string, ComponentType>;
  labels: Record<string, string>;
} | null>(null);
