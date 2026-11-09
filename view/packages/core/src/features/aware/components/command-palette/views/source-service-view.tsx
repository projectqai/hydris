import type { PageTab, PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import type { Entity } from "@projectqai/proto/world";
import { Plus } from "lucide-react-native";
import { View } from "react-native";

import { useEntityMutation } from "../../../../../lib/api/use-entity-mutation";
import { getDeviceName } from "../../../../../lib/api/use-track-utils";
import { toast } from "../../../../../lib/sonner";
import { MissionTile } from "../../../../mission/components/mission-tile";
import {
  MissionTileGrid,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { byLabel } from "../../../../mission/device-tree";
import type { ServiceRow } from "../../../../mission/provider-state";
import { isRaised } from "../../../../mission/provider-state";
import { getSourceTexts, SUBJECT_TEXTS, WITHOUT_SERVICE } from "../../../../mission/source-texts";
import type { Service, SourceKind } from "../../../../mission/sources";
import { awaitsSetup, countsInRollup } from "../../../../mission/sources";
import { useServiceState } from "../../../../mission/use-mission-state";
import { getEntityIcon, UNKNOWN_ICON } from "../../../utils/entity-helpers";
import { PageHeader } from "../../entity-header";
import { hasSchemaFields } from "../../schema-form";
import { addDeviceMode, SOURCE_ICON } from "../palette-helpers";
import { ChildTile } from "./child-tile";
import { DeviceHeader, headerStatus } from "./device-header";
import { deviceMode } from "./device-route";
import { OverviewTabs } from "./overview-tabs";

const ADD_DEVICE = "add-device";

const ACTIVATE = "activate";

type AddTile = { kind: "add"; key: string; deviceClass: string; label: string };

type Tile =
  | ({ kind: "device"; key: string } & ServiceRow)
  | { kind: "activate"; key: typeof ACTIVATE; service: Service }
  | AddTile;

export function SourceServiceView({
  source,
  providerId,
  tab = "overview",
  onTabChange,
  dispatch,
}: {
  source: SourceKind;
  providerId: string;
  tab?: PageTab;
  onTabChange: (tab: PageTab) => void;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const { service, rows, state } = useServiceState(providerId);
  const { createDevice, isPending } = useEntityMutation();
  const texts = getSourceTexts(source);
  const neverSetUp = !!service && awaitsSetup(service);
  const deviceClasses = service?.configurable?.supportedDeviceClasses ?? [];

  const shownRows = neverSetUp
    ? rows.filter(({ device, state }) => countsInRollup(device) || isRaised(state.variant))
    : rows;

  const deviceTiles: Tile[] = shownRows
    .sort((a, b) => byLabel(a.device, b.device))
    .map((row) => ({ kind: "device", key: row.device.id, ...row }));

  const addTiles: AddTile[] = (neverSetUp ? [] : deviceClasses).map((option) => ({
    kind: "add",
    key: `${ADD_DEVICE}:${option.class}`,
    deviceClass: option.class,
    label: `Add ${option.label || option.class}`,
  }));

  const tiles: Tile[] = neverSetUp
    ? [...deviceTiles, { kind: "activate", key: ACTIVATE, service }]
    : [...deviceTiles, ...addTiles];

  const openSetup = (entityId: string, created?: boolean) =>
    dispatch({ type: "push", mode: { kind: "setup", entityId, created } });

  const addDevice = async (deviceClass: string) => {
    if (isPending) return;

    try {
      openSetup(await createDevice(providerId, deviceClass), true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create device");
    }
  };

  const [onlyAdd] = addTiles.length === 1 ? addTiles : [];
  const pickClass = () => dispatch({ type: "push", mode: addDeviceMode(providerId) });

  const headerAdd = onlyAdd
    ? { label: onlyAdd.label, onPress: () => addDevice(onlyAdd.deviceClass) }
    : addTiles.length > 0
      ? { label: "Add device", onPress: pickClass }
      : undefined;

  const openDevice = (device: Entity) =>
    dispatch({ type: "push", mode: deviceMode(device, source) });

  const activateTile = (tile: Tile) => {
    if (tile.kind === "device") openDevice(tile.device);
    else if (tile.kind === "activate") openSetup(providerId);
    else void addDevice(tile.deviceClass);
  };

  const { grid, highlightedKey, itemRef } = useTileGridNav({
    tiles,
    onActivate: activateTile,
    guard: () => !!service && tab !== "overview",
  });

  if (!service && rows.length === 0) {
    return (
      <Empty>
        <EmptyTitle>{SUBJECT_TEXTS.service.gone}</EmptyTitle>
      </Empty>
    );
  }

  const tileBody = (tile: Tile, highlighted: boolean) => {
    switch (tile.kind) {
      case "device":
        return (
          <ChildTile row={tile} onPress={() => openDevice(tile.device)} highlighted={highlighted} />
        );
      case "activate":
        return (
          <MissionTile
            icon={getEntityIcon(tile.service)}
            label={`Activate ${getDeviceName(tile.service)}`}
            variant="empty"
            onPress={() => openSetup(providerId)}
            highlighted={highlighted}
          />
        );
      case "add":
        return (
          <MissionTile
            icon={Plus}
            label={tile.label}
            variant="empty"
            onPress={() => addDevice(tile.deviceClass)}
            highlighted={highlighted}
          />
        );
    }
  };

  const overview =
    tiles.length > 0 ? (
      <MissionTileGrid {...grid}>
        {tiles.map((tile) => (
          <MissionTileGridItem key={tile.key} ref={itemRef(tile.key)}>
            {tileBody(tile, tile.key === highlightedKey)}
          </MissionTileGridItem>
        ))}
      </MissionTileGrid>
    ) : (
      <Empty>
        <EmptyMedia icon={SOURCE_ICON} />
        <EmptyTitle>{texts.noDevices.title}</EmptyTitle>
        <EmptyDescription>{texts.noDevices.subtitle}</EmptyDescription>
      </Empty>
    );

  return (
    <View className="flex-1">
      {service ? (
        <DeviceHeader
          entity={service}
          state={state}
          add={headerAdd}
          onSettings={
            hasSchemaFields(service.configurable?.schema)
              ? () => dispatch({ type: "push", mode: { kind: "settings", entityId: service.id } })
              : undefined
          }
        />
      ) : (
        <PageHeader
          icon={UNKNOWN_ICON}
          title={WITHOUT_SERVICE}
          subtitle={providerId}
          status={headerStatus(state)}
        />
      )}
      <View className="bg-surface-overlay/6 mx-4 h-px" />
      {service ? (
        <OverviewTabs entity={service} tab={tab} onTabChange={onTabChange}>
          {overview}
        </OverviewTabs>
      ) : (
        overview
      )}
    </View>
  );
}
