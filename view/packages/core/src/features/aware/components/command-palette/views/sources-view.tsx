import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Blocks, Plus } from "lucide-react-native";
import { View } from "react-native";

import { MissionCountTile } from "../../../../mission/components/mission-count-tile";
import { MissionTile } from "../../../../mission/components/mission-tile";
import { MissionTileCount } from "../../../../mission/components/mission-tile-count";
import {
  MissionTileGrid,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { getSourceTexts, OTHER_SERVICES, WITHOUT_SERVICE } from "../../../../mission/source-texts";
import type { SourceKind } from "../../../../mission/sources";
import {
  useOtherServicesState,
  useSourceState,
  useWithoutServiceState,
} from "../../../../mission/use-mission-state";
import {
  useHasDevicesWithoutService,
  usePluginServiceId,
  useReportedSourceKinds,
} from "../../../../mission/use-sources";
import { UNKNOWN_ICON } from "../../../utils/entity-helpers";
import { addDeviceMode, SOURCE_ICON } from "../palette-helpers";

type SourceTile =
  | { kind: "source"; key: string; source: SourceKind; onPress: () => void }
  | {
      kind: "other-services" | "devices-without-service" | "add-custom-source";
      key: string;
      onPress?: () => void;
    };

function SourceCountTile({
  source,
  onPress,
  highlighted,
}: {
  source: SourceKind;
  onPress: () => void;
  highlighted: boolean;
}) {
  const state = useSourceState(source);
  const { title } = getSourceTexts(source);

  return (
    <MissionCountTile
      title={title}
      icon={SOURCE_ICON}
      state={state}
      emptyLabel={title}
      onPress={onPress}
      highlighted={highlighted}
    >
      {state && (
        <>
          <MissionTileCount value={state.services} label="Services" className="flex-1" />
          <View className="bg-surface-overlay/15 w-px self-stretch" />
          <MissionTileCount value={state.devices} label="Devices" className="flex-1" />
        </>
      )}
    </MissionCountTile>
  );
}

export function SourcesView({ dispatch }: { dispatch: React.Dispatch<PaletteAction> }) {
  const otherServices = useOtherServicesState();
  const withoutService = useWithoutServiceState();
  const hasDevicesWithoutService = useHasDevicesWithoutService();
  const pluginServiceId = usePluginServiceId();
  const sourceKinds = useReportedSourceKinds();

  const openSource = (source: SourceKind) => () =>
    dispatch({ type: "push", mode: { kind: "source-services", source } });

  const openOtherServices = () => dispatch({ type: "push", mode: { kind: "other-services" } });

  const openDevicesWithoutService = () =>
    dispatch({ type: "push", mode: { kind: "devices-without-service" } });

  const addCustomSource = pluginServiceId
    ? () => dispatch({ type: "push", mode: addDeviceMode(pluginServiceId) })
    : undefined;

  const tiles: SourceTile[] = sourceKinds.map((source) => ({
    kind: "source",
    key: `source:${source}`,
    source,
    onPress: openSource(source),
  }));

  if (otherServices) {
    tiles.push({ kind: "other-services", key: "other-services", onPress: openOtherServices });
  }

  if (hasDevicesWithoutService) {
    tiles.push({
      kind: "devices-without-service",
      key: "devices-without-service",
      onPress: openDevicesWithoutService,
    });
  }

  tiles.push({ kind: "add-custom-source", key: "add-custom-source", onPress: addCustomSource });

  const { grid, highlightedKey, itemRef } = useTileGridNav({
    tiles,
    isSelectable: (tile) => !!tile.onPress,
    onActivate: (tile) => tile.onPress?.(),
  });

  const tileBody = (tile: SourceTile, highlighted: boolean) => {
    switch (tile.kind) {
      case "source":
        return (
          <SourceCountTile source={tile.source} onPress={tile.onPress} highlighted={highlighted} />
        );
      case "other-services":
        return (
          <MissionTile
            title={OTHER_SERVICES}
            icon={Blocks}
            label={OTHER_SERVICES}
            state={otherServices}
            onPress={openOtherServices}
            highlighted={highlighted}
          />
        );
      case "devices-without-service":
        return (
          <MissionTile
            title={WITHOUT_SERVICE}
            icon={UNKNOWN_ICON}
            label={WITHOUT_SERVICE}
            state={withoutService}
            onPress={openDevicesWithoutService}
            highlighted={highlighted}
          />
        );
      case "add-custom-source":
        return (
          <MissionTile
            icon={Plus}
            label="Add custom source"
            variant="empty"
            onPress={addCustomSource}
            highlighted={highlighted}
          />
        );
    }
  };

  return (
    <MissionTileGrid {...grid}>
      {tiles.map((tile) => (
        <MissionTileGridItem key={tile.key} ref={itemRef(tile.key)}>
          {tileBody(tile, tile.key === highlightedKey)}
        </MissionTileGridItem>
      ))}
    </MissionTileGrid>
  );
}
