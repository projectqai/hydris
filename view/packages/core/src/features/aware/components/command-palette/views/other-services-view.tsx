import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { Blocks } from "lucide-react-native";
import { Fragment } from "react";

import {
  byHeading,
  MissionTileGrid,
  MissionTileGridHeading,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { ServiceTile } from "../../../../mission/components/service-tile";
import { useOtherServices } from "../../../../mission/use-sources";

export function OtherServicesView({ dispatch }: { dispatch: React.Dispatch<PaletteAction> }) {
  const tiles = useOtherServices()
    .map((service) => ({ key: service.id, category: service.device.category ?? "" }))
    .sort((a, b) => byHeading(a.category, b.category));

  const openConfig = (entityId: string) =>
    dispatch({ type: "push", mode: { kind: "config", entityId } });

  const { grid, highlightedKey, itemRef, startsGroup } = useTileGridNav({
    tiles,
    groupOf: (tile) => tile.category,
    onActivate: ({ key }) => openConfig(key),
  });

  if (tiles.length === 0) {
    return (
      <Empty>
        <EmptyMedia icon={Blocks} />
        <EmptyTitle>No other services</EmptyTitle>
        <EmptyDescription>
          Services without cameras or sensors appear here once set up or reporting
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <MissionTileGrid {...grid} className="content-start">
      {tiles.map(({ key, category }, i) => (
        <Fragment key={key}>
          {startsGroup(i) && (
            <MissionTileGridHeading>{category || "Miscellaneous"}</MissionTileGridHeading>
          )}
          <MissionTileGridItem ref={itemRef(key)}>
            <ServiceTile
              serviceId={key}
              onPress={() => openConfig(key)}
              highlighted={key === highlightedKey}
            />
          </MissionTileGridItem>
        </Fragment>
      ))}
    </MissionTileGrid>
  );
}
