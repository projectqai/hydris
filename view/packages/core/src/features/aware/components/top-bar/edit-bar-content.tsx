import type { EditKind } from "@hydris/map-engine/types";
import { ControlButton, ControlStepper } from "@hydris/ui/controls";
import { EditHelpIcon } from "@hydris/ui/top-bar/edit-help-icon";
import { Check, Undo2 } from "lucide-react-native";

import { TOOL } from "../../utils/map-paths";
import { TOOL_ICON } from "../tool-icons";
import { ModeBarContent } from "./mode-bar-content";

export function EditBarContent({
  isTouchInput,
  kind,
  canUndo,
  rings,
  onRingsChange,
  onUndo,
  onEnd,
}: {
  isTouchInput: boolean;
  kind: EditKind;
  canUndo: boolean;
  rings?: number;
  onRingsChange: (rings: number) => void;
  onUndo: () => void;
  onEnd: () => void;
}) {
  return (
    <ModeBarContent
      icon={TOOL_ICON[kind]}
      label={`Editing ${TOOL[kind].label}`}
      help={<EditHelpIcon isTouchInput={isTouchInput} kind={kind} />}
    >
      {rings !== undefined && (
        <ControlStepper
          value={rings}
          onValueChange={onRingsChange}
          min={1}
          max={10}
          step={1}
          accessibilityLabel="Number of rings"
        />
      )}
      <ControlButton
        onPress={onUndo}
        icon={Undo2}
        label="Undo"
        disabled={!canUndo}
        size="lg"
        labelClassName="font-sans-medium text-11"
        accessibilityLabel="Undo edit"
      />
      <ControlButton
        onPress={onEnd}
        icon={Check}
        label="Finish"
        variant="active"
        size="lg"
        labelClassName="font-sans-semibold text-11"
        accessibilityLabel="Finish editing"
      />
    </ModeBarContent>
  );
}
