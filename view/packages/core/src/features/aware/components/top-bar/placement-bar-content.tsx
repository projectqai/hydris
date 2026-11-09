import { ControlButton } from "@hydris/ui/controls";
import { PlacementHelpIcon } from "@hydris/ui/top-bar/placement-help-icon";
import { Keyboard, Move, X } from "lucide-react-native";

import { ModeBarContent } from "./mode-bar-content";

type PlacementBarContentProps = {
  onConfirm: () => void;
  onAbort: () => void;
  onTypeCoordinates: () => void;
};

export function PlacementBarContent({
  onConfirm,
  onAbort,
  onTypeCoordinates,
}: PlacementBarContentProps) {
  return (
    <ModeBarContent icon={Move} label="Set position" help={<PlacementHelpIcon />}>
      <ControlButton
        onPress={onTypeCoordinates}
        icon={Keyboard}
        label="Enter coordinates"
        variant="active"
        size="lg"
        labelClassName="font-sans-medium text-11"
        accessibilityLabel="Enter coordinates manually"
      />
      <ControlButton
        onPress={onAbort}
        icon={X}
        label="Cancel"
        variant="destructive"
        size="lg"
        labelClassName="font-sans-semibold text-11"
        accessibilityLabel="Cancel placement"
      />
      <ControlButton
        onPress={onConfirm}
        label="Confirm"
        variant="success"
        size="lg"
        labelClassName="font-sans-semibold text-11"
        accessibilityLabel="Confirm position"
      />
    </ModeBarContent>
  );
}
