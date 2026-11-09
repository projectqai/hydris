import type { CardIconComponent, CardVariant } from "@hydris/ui/card";
import { Card, CardArrow, CardContent, CardFooter } from "@hydris/ui/card";
import type { ReactNode } from "react";

import type { CategoryState } from "../provider-state";
import { MissionTileAlert, MissionTileMessage } from "./mission-tile-message";
import { MissionTileHeader } from "./mission-tile-status";

export function MissionCountTile({
  title,
  icon,
  state,
  emptyLabel,
  emptyVariant,
  onPress,
  highlighted,
  children,
}: {
  title: string;
  icon: CardIconComponent;
  state: CategoryState | undefined;
  emptyLabel: string;
  emptyVariant?: Extract<CardVariant, "empty">;
  onPress: () => void;
  highlighted: boolean;
  children: ReactNode;
}) {
  return (
    <Card variant={state?.variant ?? emptyVariant} onPress={onPress} highlighted={highlighted}>
      <MissionTileHeader title={title} icon={state ? icon : undefined} state={state} />
      <CardContent className={state && state.variant !== "alert" ? "flex-row" : "gap-2.5"}>
        {!state ? (
          <MissionTileMessage icon={icon} label={emptyLabel} />
        ) : state.variant === "alert" ? (
          <MissionTileAlert label={state.label} />
        ) : (
          children
        )}
      </CardContent>
      <CardFooter>
        <CardArrow />
      </CardFooter>
    </Card>
  );
}
