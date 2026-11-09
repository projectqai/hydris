import type { PageTab, PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyTitle } from "@hydris/ui/empty-state";
import type { Entity } from "@projectqai/proto/world";
import { View } from "react-native";

import { DeviceTile } from "../../../../mission/components/device-tile";
import {
  MissionTileGrid,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { byLabel } from "../../../../mission/device-tree";
import type { ServiceRow } from "../../../../mission/provider-state";
import type { SourceKind } from "../../../../mission/sources";
import { useDeviceState, useOwnState } from "../../../../mission/use-mission-state";
import { useEntityStore } from "../../../store/entity-store";
import { hasSchemaFields } from "../../schema-form";
import { ChildTile } from "./child-tile";
import { DeviceHeader } from "./device-header";
import { deviceMode } from "./device-route";
import { OverviewTabs } from "./overview-tabs";

type OverviewTile = { key: string; row?: ServiceRow };

function Overview({
  device,
  rows,
  source,
  active,
  onSettings,
  dispatch,
}: {
  device: Entity;
  rows: ServiceRow[];
  source?: SourceKind;
  active: boolean;
  onSettings?: () => void;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const own = useOwnState(device);

  const tiles: OverviewTile[] = [
    { key: device.id },
    ...[...rows]
      .sort((a, b) => byLabel(a.device, b.device))
      .map((row) => ({ key: row.device.id, row })),
  ];

  const open = (child: Entity) => dispatch({ type: "push", mode: deviceMode(child, source) });

  const { grid, highlightedKey, itemRef } = useTileGridNav({
    tiles,
    isSelectable: (tile) => !!tile.row || !!onSettings,
    onActivate: (tile) => (tile.row ? open(tile.row.device) : onSettings?.()),
    guard: () => !active,
  });

  return (
    <MissionTileGrid {...grid}>
      {tiles.map(({ key, row }) => (
        <MissionTileGridItem key={key} ref={itemRef(key)}>
          {row ? (
            <ChildTile
              row={row}
              onPress={() => open(row.device)}
              highlighted={key === highlightedKey}
            />
          ) : (
            <DeviceTile
              device={device}
              state={own}
              onPress={onSettings}
              highlighted={key === highlightedKey}
            />
          )}
        </MissionTileGridItem>
      ))}
    </MissionTileGrid>
  );
}

type TabProps = { tab?: PageTab; onTabChange: (tab: PageTab) => void };

function DevicePage({
  device,
  source,
  tab = "overview",
  onTabChange,
  dispatch,
}: TabProps & {
  device: Entity;
  source?: SourceKind;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const { rows, state } = useDeviceState(device);

  const onSettings = hasSchemaFields(device.configurable?.schema)
    ? () => dispatch({ type: "push", mode: { kind: "settings", entityId: device.id } })
    : undefined;

  return (
    <View className="flex-1">
      <DeviceHeader entity={device} state={state} onSettings={onSettings} />
      <View className="bg-surface-overlay/6 mx-4 h-px" />
      <OverviewTabs entity={device} tab={tab} onTabChange={onTabChange}>
        <Overview
          device={device}
          rows={rows}
          source={source}
          active={tab === "overview"}
          onSettings={onSettings}
          dispatch={dispatch}
        />
      </OverviewTabs>
    </View>
  );
}

export function DeviceView({
  source,
  entityId,
  tab,
  onTabChange,
  dispatch,
}: TabProps & {
  source?: SourceKind;
  entityId: string;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const device = useEntityStore((s) => s.entities.get(entityId));

  if (!device) {
    return (
      <Empty>
        <EmptyTitle>Device no longer exists</EmptyTitle>
      </Empty>
    );
  }

  return (
    <DevicePage
      device={device}
      source={source}
      tab={tab}
      onTabChange={onTabChange}
      dispatch={dispatch}
    />
  );
}
