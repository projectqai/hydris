import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyDescription, EmptyLink, EmptyMedia } from "@hydris/ui/empty-state";
import { Grid2x2Plus, Plus } from "lucide-react-native";

import { MissionTile } from "../../../../mission/components/mission-tile";
import {
  MissionTileGrid,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { ServiceTile } from "../../../../mission/components/service-tile";
import { getSourceTexts } from "../../../../mission/source-texts";
import type { SourceKind } from "../../../../mission/sources";
import { inRollup } from "../../../../mission/sources";
import { usePluginServiceId, useSourceServices } from "../../../../mission/use-sources";
import { addDeviceMode } from "../palette-helpers";
import { openService } from "./device-route";

const ADD_SERVICE = "add-service";

type Tile = { key: string; serviceId?: string };

export function SourceServicesView({
  source,
  dispatch,
}: {
  source: SourceKind;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const texts = getSourceTexts(source);
  const services = useSourceServices(source);
  const withState = useSourceServices(source, (group) => !group.service || inRollup(group));
  const addsService = withState.length > 0 && withState.length < services.length;
  const listed = addsService ? withState : services;

  const tiles: Tile[] = listed.map((serviceId) => ({ key: serviceId, serviceId }));

  if (addsService) tiles.push({ key: ADD_SERVICE });

  const openAddService = () =>
    dispatch({ type: "push", mode: { kind: "add-source-service", source } });

  const { grid, highlightedKey, itemRef } = useTileGridNav({
    tiles,
    onActivate: ({ serviceId }) =>
      serviceId ? openService(serviceId, source, dispatch) : openAddService(),
  });

  const pluginServiceId = usePluginServiceId();

  if (tiles.length === 0) {
    return (
      <Empty>
        <EmptyMedia icon={Grid2x2Plus} />
        <EmptyDescription>
          {texts.connect}
          {pluginServiceId && (
            <>
              {" or "}
              <EmptyLink
                onPress={() => dispatch({ type: "push", mode: addDeviceMode(pluginServiceId) })}
              >
                add a plugin
              </EmptyLink>
            </>
          )}
          .
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <MissionTileGrid {...grid}>
      {tiles.map(({ key, serviceId }) => (
        <MissionTileGridItem key={key} ref={itemRef(key)}>
          {serviceId ? (
            <ServiceTile
              serviceId={serviceId}
              onPress={() => openService(serviceId, source, dispatch)}
              highlighted={key === highlightedKey}
            />
          ) : (
            <MissionTile
              icon={Plus}
              label={texts.addService}
              variant="empty"
              onPress={openAddService}
              highlighted={key === highlightedKey}
            />
          )}
        </MissionTileGridItem>
      ))}
    </MissionTileGrid>
  );
}
