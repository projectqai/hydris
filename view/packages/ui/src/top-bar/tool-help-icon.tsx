import { useThemeColors } from "../lib/theme";
import type { HelpItem } from "./help-icon";
import { HelpIcon } from "./help-icon";

// Every map tool's help reads in the mode bar's accent, so the colour is not a
// per-tool choice.
export function ToolHelpIcon({ items, label }: { items: readonly HelpItem[]; label: string }) {
  const t = useThemeColors();
  return <HelpIcon items={items} label={label} color={t.placementAccent} />;
}
