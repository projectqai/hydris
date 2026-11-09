import type { HelpItem } from "./help-icon";
import { ToolHelpIcon } from "./tool-help-icon";

const SHAPE_TOUCH: Record<string, HelpItem[]> = {
  range: [{ key: "Two handles", text: "Either end re-aims the line" }],
  circle: [
    { key: "Centre", text: "Drag it to move the whole circle" },
    { key: "Edge", text: "Drag it to change the radius" },
  ],
  "rb-circle": [
    { key: "Centre", text: "Drag it to move the whole shape" },
    { key: "Edge", text: "Drag it to change the radius" },
    { key: "Rings", text: "Change how many at any time" },
  ],
  rectangle: [{ key: "Three handles", text: "The corners you tapped, not the four drawn" }],
  freeform: [
    { key: "Handles", text: "One on every point" },
    { key: "Hold a segment", text: "Insert a new point" },
  ],
};

const SHAPE_POINTER: Record<string, HelpItem[]> = {
  range: [{ key: "Two handles", text: "Either end re-aims the line" }],
  circle: [
    { key: "Centre", text: "Drag it to move the whole circle" },
    { key: "Edge", text: "Drag it to change the radius" },
  ],
  "rb-circle": [
    { key: "Centre", text: "Drag it to move the whole shape" },
    { key: "Edge", text: "Drag it to change the radius" },
    { key: "Rings", text: "Change how many at any time" },
  ],
  rectangle: [{ key: "Three handles", text: "The corners you clicked, not the four drawn" }],
  freeform: [{ key: "Handles", text: "One on every point" }],
};

const HELP_ITEMS_TOUCH: HelpItem[] = [
  { key: "Drag", text: "Move a handle to reshape" },
  { key: "Undo", text: "Step back one move" },
  { key: "Finish", text: "Keep the changes" },
];

const HELP_ITEMS_POINTER: HelpItem[] = [
  { key: "Drag", text: "Move a handle to reshape" },
  { key: "Backspace", text: "Step back one move" },
  { key: "Enter or double-click", text: "Keeps the changes" },
  { key: "Esc", text: "Discard every change" },
];

export function EditHelpIcon({
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
      label="Edit help"
    />
  );
}
