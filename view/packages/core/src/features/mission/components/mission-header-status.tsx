import type { StatusLabelVariant } from "@hydris/ui/status-label";
import { StatusLabel } from "@hydris/ui/status-label";

import type { TileState, TileVariant } from "../provider-state";
import { useStateLabel } from "../use-mission-state";

export const HEADER_STATUS_VARIANTS: Record<TileVariant, StatusLabelVariant> = {
  default: "plain-neutral",
  success: "plain-success",
  pending: "plain-pending",
  alert: "plain-alert",
};

export function MissionHeaderStatus({ state }: { state: TileState }) {
  const label = useStateLabel(state);

  return <StatusLabel variant={HEADER_STATUS_VARIANTS[state.variant]}>{label}</StatusLabel>;
}
