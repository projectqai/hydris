import { ControlButton } from "@hydris/ui/controls";
import { X } from "lucide-react-native";

import { TOOL_ICON } from "../tool-icons";
import { ModeBarContent } from "./mode-bar-content";

export function BullseyeBarContent({ onCancel }: { onCancel: () => void }) {
  return (
    <ModeBarContent icon={TOOL_ICON.bullseye} label="Bullseye">
      <ControlButton
        onPress={onCancel}
        icon={X}
        label="Cancel"
        size="lg"
        labelClassName="font-sans-semibold text-11"
        accessibilityLabel="Cancel bullseye"
      />
    </ModeBarContent>
  );
}
