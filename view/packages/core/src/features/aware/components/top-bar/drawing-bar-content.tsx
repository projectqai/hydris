import type { DrawingKind } from "@hydris/map-engine/types";
import { ControlButton, ControlStepper } from "@hydris/ui/controls";
import { DrawingHelpIcon } from "@hydris/ui/top-bar/drawing-help-icon";
import { Check, Undo2, X } from "lucide-react-native";

import { TOOL_ICON } from "../tool-icons";
import { ModeBarContent } from "./mode-bar-content";

export function DrawingBarContent({
  isTouchInput,
  kind,
  label,
  canUndo,
  onFinish,
  onUndo,
  onCancel,
  rings,
  onRingsChange,
}: {
  isTouchInput: boolean;
  kind: DrawingKind | null;
  label: string;
  canUndo: boolean;
  onFinish?: () => void;
  onUndo: () => void;
  onCancel: () => void;
  rings?: number;
  onRingsChange: (rings: number) => void;
}) {
  return (
    <ModeBarContent
      icon={kind ? TOOL_ICON[kind] : undefined}
      label={label}
      help={<DrawingHelpIcon isTouchInput={isTouchInput} kind={kind} />}
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
        accessibilityLabel="Undo last point"
      />
      <ControlButton
        onPress={onCancel}
        icon={X}
        label="Cancel"
        size="lg"
        labelClassName="font-sans-semibold text-11"
        accessibilityLabel="Cancel drawing"
      />
      {onFinish && (
        <ControlButton
          onPress={onFinish}
          icon={Check}
          label="Finish"
          size="lg"
          labelClassName="font-sans-semibold text-11"
          accessibilityLabel="Finish drawing"
        />
      )}
    </ModeBarContent>
  );
}
