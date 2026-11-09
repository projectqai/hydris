import type { ReactNode } from "react";
import { useSharedValue } from "react-native-reanimated";
import { fn } from "storybook/test";

import { LayoutEditingContext } from "../layout/contexts";
import type { LayoutEditingContextValue } from "../layout/types";

type Handlers = Omit<
  LayoutEditingContextValue,
  "customizeProgress" | "isCustomizing" | "totalPanes" | "swapSourceId" | "pickerState"
>;

const HANDLERS: Handlers = {
  onSplit: fn().mockName("onSplit"),
  onRemove: fn().mockName("onRemove"),
  onChangeContent: fn().mockName("onChangeContent"),
  onRatioChange: fn().mockName("onRatioChange"),
  onSwapStart: fn().mockName("onSwapStart"),
  onSwapTarget: fn().mockName("onSwapTarget"),
  openPicker: fn().mockName("openPicker"),
  closePicker: fn().mockName("closePicker"),
  openEntityPicker: fn().mockName("openEntityPicker"),
};

type Props = Partial<Handlers> & {
  isCustomizing?: boolean;
  totalPanes?: number;
  children: ReactNode;
};

export function FakeLayoutEditing({
  isCustomizing = false,
  totalPanes = 2,
  children,
  ...handlers
}: Props) {
  const customizeProgress = useSharedValue(isCustomizing ? 1 : 0);

  return (
    <LayoutEditingContext.Provider
      value={{
        ...HANDLERS,
        ...handlers,
        customizeProgress,
        isCustomizing,
        totalPanes,
        swapSourceId: null,
        pickerState: null,
      }}
    >
      {children}
    </LayoutEditingContext.Provider>
  );
}
