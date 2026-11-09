import { Platform } from "react-native";

import type { HelpItem } from "./help-icon";
import { HelpIcon } from "./help-icon";

const HELP_ITEMS_BASE: HelpItem[] = [
  { key: "Dividers", text: "Drag to resize panes" },
  { key: "Headers", text: "Split, swap, or remove panes" },
];

const HELP_ITEMS_WEB = [...HELP_ITEMS_BASE, { key: "Esc", text: "Exit editing mode" }];

const HELP_ITEMS = Platform.OS === "web" ? HELP_ITEMS_WEB : HELP_ITEMS_BASE;

export function CustomizeHelpIcon() {
  return (
    <HelpIcon items={HELP_ITEMS} label="Layout editing help" color="rgba(255, 255, 255, 0.9)" />
  );
}
