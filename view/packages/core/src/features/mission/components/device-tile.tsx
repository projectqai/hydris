import { useCard } from "@hydris/ui/card";
import { cn } from "@hydris/ui/lib/utils";
import { MiddleTruncateText } from "@hydris/ui/middle-truncate-text";
import type { Entity } from "@projectqai/proto/world";
import { View } from "react-native";

import { getDeviceName } from "../../../lib/api/use-track-utils";
import {
  DEVICE_STATE_KEY,
  readStatus,
} from "../../aware/components/configuration-modal/status-section";
import { getEntityIcon } from "../../aware/utils/entity-helpers";
import type { OwnState } from "../provider-state";
import { MissionTile } from "./mission-tile";
import { MissionTileRow } from "./mission-tile-row";

function PropertyRow({ label, value }: { label: string; value: string }) {
  const { text } = useCard();

  return (
    <MissionTileRow
      label={label}
      className="flex-nowrap"
      labelClassName="shrink-0 grow-0 basis-auto"
    >
      <View className="min-w-0 flex-1">
        <MiddleTruncateText
          text={value}
          evenSplit
          className={cn("text-11 font-mono leading-tight", text.content)}
        />
      </View>
    </MissionTileRow>
  );
}

export function DeviceTile({
  device,
  state,
  onPress,
  highlighted,
}: {
  device: Entity;
  state: OwnState;
  onPress?: () => void;
  highlighted?: boolean;
}) {
  const label = getDeviceName(device);

  const rowsBelowHeader = readStatus(device)
    .flatMap((group) => group.rows)
    .filter((row) => row.key !== DEVICE_STATE_KEY);

  return (
    <MissionTile
      title={label}
      icon={getEntityIcon(device)}
      label={label}
      state={state}
      onPress={onPress}
      highlighted={highlighted}
    >
      {rowsBelowHeader.length > 0
        ? rowsBelowHeader.map((row) => (
            <PropertyRow key={row.key} label={row.label} value={row.value} />
          ))
        : undefined}
    </MissionTile>
  );
}
