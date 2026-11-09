"use no memo";

import type { ReactNode } from "react";
import { View } from "react-native";
import { runOnUI, useSharedValue } from "react-native-reanimated";

import { PanelContext, type PanelContextValue } from "./panel-context";

type PanelProviderProps = {
  children: ReactNode;
};

export function PanelProvider({ children }: PanelProviderProps) {
  const isFullscreen = useSharedValue(false);
  const rightPanelCollapsed = useSharedValue(false);

  const collapseAll = () => {
    runOnUI(() => {
      "worklet";
      isFullscreen.value = true;
    })();
  };

  const contextValue: PanelContextValue = {
    isFullscreen,
    rightPanelCollapsed,
    collapseAll,
  };

  return (
    <PanelContext.Provider value={contextValue}>
      <View className="flex-1">{children}</View>
    </PanelContext.Provider>
  );
}
