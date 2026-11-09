import type { CardIconComponent, CardVariant } from "@hydris/ui/card";
import { CardAction, CardHeader, CardTitle, useCard } from "@hydris/ui/card";
import type { StatusLabelVariant } from "@hydris/ui/status-label";
import { StatusLabel } from "@hydris/ui/status-label";

import type { TileState, TileVariant } from "../provider-state";
import { useStateLabel } from "../use-mission-state";
import { HEADER_STATUS_VARIANTS } from "./mission-header-status";

type StatusState = Pick<TileState, "label" | "scheduledAt">;

const STATUS_VARIANTS: Record<CardVariant, StatusLabelVariant> = {
  empty: "neutral",
  default: "neutral",
  success: "success",
  info: "info",
  pending: "pending",
  alert: "alert",
};

export function MissionTileStatus({
  variant,
  state,
}: {
  variant?: TileVariant;
  state: StatusState;
}) {
  const card = useCard();
  const label = useStateLabel(state);
  const fillHidesStateColours = card.variant === "alert";

  const look =
    fillHidesStateColours || !variant
      ? STATUS_VARIANTS[card.variant]
      : HEADER_STATUS_VARIANTS[variant];

  return <StatusLabel variant={look}>{label}</StatusLabel>;
}

export function MissionTileHeader({
  title,
  icon,
  state,
}: {
  title?: string;
  icon?: CardIconComponent;
  state?: StatusState;
}) {
  return (
    <CardHeader>
      {title && <CardTitle icon={icon}>{title}</CardTitle>}
      {state?.label && (
        <CardAction>
          <MissionTileStatus state={state} />
        </CardAction>
      )}
    </CardHeader>
  );
}
