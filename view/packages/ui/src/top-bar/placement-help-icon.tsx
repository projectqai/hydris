import { Platform } from "react-native";

import { useThemeColors } from "../lib/theme";
import type { HelpItem } from "./help-icon";
import { HelpIcon } from "./help-icon";

const HELP_ITEMS_BASE: HelpItem[] = [
  { key: "Pan", text: "Move the map to position the entity" },
  { key: "Confirm", text: "Save the position at map centre" },
];

const HELP_ITEMS_WEB = [...HELP_ITEMS_BASE, { key: "Esc", text: "Cancel placement" }];

const HELP_ITEMS = Platform.OS === "web" ? HELP_ITEMS_WEB : HELP_ITEMS_BASE;

export function PlacementHelpIcon() {
  const t = useThemeColors();

  return <HelpIcon items={HELP_ITEMS} label="Placement help" color={t.placementAccent} />;
}
