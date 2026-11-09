import { ControlButton } from "@hydris/ui/controls";
import { RangeHelpIcon } from "@hydris/ui/top-bar/range-help-icon";
import { Check, Undo2 } from "lucide-react-native";

import { TOOL_ICON } from "../tool-icons";
import { ModeBarContent } from "./mode-bar-content";

export function RangeBarContent({
  isTouchInput,
  label,
  canUndo,
  onFinish,
  onUndo,
}: {
  isTouchInput: boolean;
  label: string;
  canUndo: boolean;
  onFinish: () => void;
  onUndo: () => void;
}) {
  return (
    <ModeBarContent
      icon={TOOL_ICON.range}
      label={label}
      help={<RangeHelpIcon isTouchInput={isTouchInput} />}
    >
      <ControlButton
        onPress={onUndo}
        icon={Undo2}
        label="Undo"
        disabled={!canUndo}
        size="lg"
        labelClassName="font-sans-medium text-11"
        accessibilityLabel="Undo range point"
      />
      <ControlButton
        onPress={onFinish}
        icon={Check}
        label="Finish"
        variant="active"
        size="lg"
        labelClassName="font-sans-semibold text-11"
        accessibilityLabel="Finish range and bearing"
      />
    </ModeBarContent>
  );
}
