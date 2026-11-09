import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

export type PanelContextValue = {
  isFullscreen: SharedValue<boolean>;
  rightPanelCollapsed: SharedValue<boolean>;
  collapseAll: () => void;
};

export const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanelContext() {
  const context = useContext(PanelContext);
  if (!context) {
    throw new Error("usePanelContext must be used within PanelProvider");
  }
  return context;
}
