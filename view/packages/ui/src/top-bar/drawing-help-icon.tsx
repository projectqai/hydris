import type { HelpItem } from "./help-icon";
import { ToolHelpIcon } from "./tool-help-icon";

// The gesture is the whole difference between these tools, so the help says it
// rather than describing drawing in general.
const SHAPE_TOUCH: Record<string, HelpItem[]> = {
  "rb-circle": [{ key: "Rings", text: "Set how many before you finish" }],
  freeform: [],
};

const SHAPE_POINTER: Record<string, HelpItem[]> = {
  "rb-circle": [{ key: "Rings", text: "Set how many before you finish" }],
  freeform: [{ key: "Enter or double-click", text: "Ends an open line" }],
};

const HELP_ITEMS_TOUCH: HelpItem[] = [
  { key: "Undo", text: "Take back the last point" },
  { key: "Hold", text: "Open the menu on a finished shape" },
];

const HELP_ITEMS_POINTER: HelpItem[] = [
  { key: "Move", text: "The shape follows the pointer as you aim" },
  { key: "Backspace", text: "Undo the last point" },
  { key: "Esc", text: "Cancel the drawing" },
  { key: "Right-click", text: "Open the menu on a finished shape" },
];

export function DrawingHelpIcon({
  isTouchInput,
  kind,
}: {
  isTouchInput: boolean;
  kind: string | null;
}) {
  const shape = (isTouchInput ? SHAPE_TOUCH : SHAPE_POINTER)[kind ?? ""] ?? [];
  return (
    <ToolHelpIcon
      items={[...shape, ...(isTouchInput ? HELP_ITEMS_TOUCH : HELP_ITEMS_POINTER)]}
      label="Drawing help"
    />
  );
}
