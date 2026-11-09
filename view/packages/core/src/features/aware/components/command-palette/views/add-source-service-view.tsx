import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";

import {
  MissionTileGrid,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { ServiceTile } from "../../../../mission/components/service-tile";
import { getSourceTexts } from "../../../../mission/source-texts";
import type { SourceKind } from "../../../../mission/sources";
import { awaitsSetup } from "../../../../mission/sources";
import { useSourceServices } from "../../../../mission/use-sources";
import { SOURCE_ICON } from "../palette-helpers";
import { openService } from "./device-route";

export function AddSourceServiceView({
  source,
  dispatch,
}: {
  source: SourceKind;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const tiles = useSourceServices(source, ({ service }) => !!service && awaitsSetup(service)).map(
    (serviceId) => ({ key: serviceId }),
  );

  const { grid, highlightedKey, itemRef } = useTileGridNav({
    tiles,
    onActivate: ({ key }) => openService(key, source, dispatch),
  });

  if (tiles.length === 0) {
    const { allSetUp } = getSourceTexts(source);

    return (
      <Empty>
        <EmptyMedia icon={SOURCE_ICON} />
        <EmptyTitle>{allSetUp.title}</EmptyTitle>
        <EmptyDescription>{allSetUp.subtitle}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <MissionTileGrid {...grid}>
      {tiles.map(({ key }) => (
        <MissionTileGridItem key={key} ref={itemRef(key)}>
          <ServiceTile
            serviceId={key}
            onPress={() => openService(key, source, dispatch)}
            highlighted={key === highlightedKey}
          />
        </MissionTileGridItem>
      ))}
    </MissionTileGrid>
  );
}
