import { ControlButton, ControlIconButton } from "@hydris/ui/controls";
import type { Entity } from "@projectqai/proto/world";
import { Plus, Settings2 } from "lucide-react-native";
import { View } from "react-native";

import { getDeviceName } from "../../../../../lib/api/use-track-utils";
import { MissionHeaderStatus } from "../../../../mission/components/mission-header-status";
import type { TileState } from "../../../../mission/provider-state";
import { useOwnState } from "../../../../mission/use-mission-state";
import { EntityHeader } from "../../entity-header";
import { ErrorNotice } from "../../error-notice";

type AddAction = { label: string; onPress: () => void };

export function headerStatus(state: TileState) {
  return state.label ? <MissionHeaderStatus state={state} /> : undefined;
}

export function DeviceHeader({
  entity,
  state,
  add,
  onSettings,
}: {
  entity: Entity;
  state?: TileState;
  add?: AddAction;
  onSettings?: () => void;
}) {
  const own = useOwnState(entity);

  return (
    <>
      <EntityHeader
        entity={entity}
        title={getDeviceName(entity)}
        status={headerStatus(state ?? own)}
      >
        <View className="flex-row items-center gap-1.5">
          {add && (
            <ControlIconButton
              icon={Plus}
              onPress={add.onPress}
              size="sm"
              accessibilityLabel={add.label}
            />
          )}
          {onSettings && (
            <ControlButton
              icon={Settings2}
              label="Config"
              onPress={onSettings}
              variant={own.error ? "error" : "default"}
              size="sm"
            />
          )}
        </View>
      </EntityHeader>
      {own.error && <ErrorNotice className="mx-4 mb-3">{`${own.label}: ${own.error}`}</ErrorNotice>}
    </>
  );
}
