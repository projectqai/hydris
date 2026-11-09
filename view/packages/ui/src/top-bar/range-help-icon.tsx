import type { HelpItem } from "./help-icon";
import { ToolHelpIcon } from "./tool-help-icon";

const HELP_ITEMS_TOUCH: HelpItem[] = [
  { key: "Drag", text: "Move a point while placing it" },
  { key: "Hold", text: "Open the menu on a finished R&B" },
];

const HELP_ITEMS_POINTER: HelpItem[] = [
  { key: "Drag", text: "Move a point while placing it" },
  { key: "Backspace", text: "Undo the last point" },
  { key: "Enter", text: "Finish the R&B" },
  { key: "Esc", text: "Discard the R&B" },
  { key: "Right-click", text: "Open the menu on a finished R&B" },
];

export function RangeHelpIcon({ isTouchInput }: { isTouchInput: boolean }) {
  return (
    <ToolHelpIcon items={isTouchInput ? HELP_ITEMS_TOUCH : HELP_ITEMS_POINTER} label="Range help" />
  );
}
