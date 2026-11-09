import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import type { Entity } from "@projectqai/proto/world";
import { Unplug } from "lucide-react-native";
import { Fragment } from "react";

import { DeviceTile } from "../../../../mission/components/device-tile";
import {
  MissionTileGrid,
  MissionTileGridHeading,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { getOwnState } from "../../../../mission/provider-state";
import { useDevicesWithoutService } from "../../../../mission/use-sources";
import { deviceMode } from "./device-route";

export function DevicesWithoutServiceView({
  dispatch,
}: {
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const groups = useDevicesWithoutService();

  const tiles = groups.flatMap(({ serviceId, devices }) =>
    devices.map((device) => ({ key: device.id, device, serviceId })),
  );

  const openDevice = (device: Entity) => dispatch({ type: "push", mode: deviceMode(device) });

  const { grid, highlightedKey, itemRef, startsGroup } = useTileGridNav({
    tiles,
    groupOf: (tile) => tile.serviceId,
    onActivate: ({ device }) => openDevice(device),
  });

  if (tiles.length === 0) {
    return (
      <Empty>
        <EmptyMedia icon={Unplug} />
        <EmptyTitle>No devices without a service</EmptyTitle>
        <EmptyDescription>Devices whose service is missing appear here</EmptyDescription>
      </Empty>
    );
  }

  return (
    <MissionTileGrid {...grid} className="content-start">
      {tiles.map(({ key, device, serviceId }, i) => (
        <Fragment key={key}>
          {startsGroup(i) && <MissionTileGridHeading>{serviceId}</MissionTileGridHeading>}
          <MissionTileGridItem ref={itemRef(key)}>
            <DeviceTile
              device={device}
              state={getOwnState(device, false)}
              onPress={() => openDevice(device)}
              highlighted={key === highlightedKey}
            />
          </MissionTileGridItem>
        </Fragment>
      ))}
    </MissionTileGrid>
  );
}
