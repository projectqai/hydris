import type { CardIconComponent, CardVariant } from "@hydris/ui/card";
import { Card, CardArrow, CardContent, CardFooter } from "@hydris/ui/card";
import type { ReactNode } from "react";

import type { TileState } from "../provider-state";
import { MissionTileAlert, MissionTileMessage } from "./mission-tile-message";
import { MissionTileHeader } from "./mission-tile-status";

export function MissionTile({
  title,
  icon,
  label,
  state,
  onPress,
  variant,
  highlighted,
  children,
}: {
  title?: string;
  icon: CardIconComponent;
  label: string;
  state?: Pick<TileState, "variant" | "label" | "scheduledAt">;
  onPress?: () => void;
  variant?: CardVariant;
  highlighted?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card variant={state?.variant ?? variant} onPress={onPress} highlighted={highlighted}>
      <MissionTileHeader title={title} state={state} />
      <CardContent className={children ? "items-stretch" : undefined}>
        {children ??
          (state?.variant === "alert" ? (
            <MissionTileAlert label={state.label ?? label} />
          ) : (
            <MissionTileMessage icon={icon} label={label} />
          ))}
      </CardContent>
      <CardFooter>{onPress && <CardArrow />}</CardFooter>
    </Card>
  );
}
