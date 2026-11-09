import { Card, CardArrow, CardContent, CardFooter, CardHeader, CardTitle } from "@hydris/ui/card";
import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Focus, Import, Radar, SquareActivity } from "lucide-react-native";

import { MissionCountTile } from "../../../../mission/components/mission-count-tile";
import { MissionTile } from "../../../../mission/components/mission-tile";
import { MissionTileCount } from "../../../../mission/components/mission-tile-count";
import {
  MissionTileGrid,
  MissionTileGridItem,
  useTileGridNav,
} from "../../../../mission/components/mission-tile-grid";
import { MissionTileMessage } from "../../../../mission/components/mission-tile-message";
import { useSourcesState } from "../../../../mission/use-mission-state";
import { selectTracks, useEntityStore } from "../../../store/entity-store";

type Tile = { key: "sources" | "assets" | "tracks" | "import"; onPress: () => void };

export function MissionView({
  dispatch,
  onImport,
}: {
  dispatch: React.Dispatch<PaletteAction>;
  onImport?: () => void;
}) {
  const sources = useSourcesState();
  const trackCount = useEntityStore((s) => selectTracks(s).length);
  const openSources = () => dispatch({ type: "push", mode: { kind: "sources" } });
  const openAssets = () => dispatch({ type: "push", mode: { kind: "asset-readiness" } });
  const openTracks = () => dispatch({ type: "push", mode: { kind: "tracks" } });

  const tiles: Tile[] = [
    { key: "sources", onPress: openSources },
    { key: "assets", onPress: openAssets },
    { key: "tracks", onPress: openTracks },
  ];

  if (onImport) tiles.push({ key: "import", onPress: onImport });

  const { grid, highlightedKey, itemRef } = useTileGridNav({
    tiles,
    onActivate: (tile) => tile.onPress(),
  });

  const tileBody = ({ key, onPress }: Tile, highlighted: boolean) => {
    switch (key) {
      case "sources":
        return (
          <MissionCountTile
            title="Sources"
            icon={Radar}
            state={sources}
            emptyLabel="Add sources"
            emptyVariant="empty"
            onPress={onPress}
            highlighted={highlighted}
          >
            {sources && <MissionTileCount value={sources.devices} label="Devices" />}
          </MissionCountTile>
        );
      case "assets":
        return (
          <MissionTile
            title="Assets"
            icon={SquareActivity}
            label="Asset readiness"
            variant="empty"
            onPress={onPress}
            highlighted={highlighted}
          />
        );
      case "tracks":
        return (
          <Card
            variant={trackCount ? "default" : "empty"}
            onPress={onPress}
            highlighted={highlighted}
          >
            <CardHeader>
              <CardTitle icon={trackCount ? Focus : undefined}>Tracks</CardTitle>
            </CardHeader>
            <CardContent>
              {trackCount ? (
                <MissionTileCount value={trackCount} label="Tracks" />
              ) : (
                <MissionTileMessage icon={Focus} label="Tracks" />
              )}
            </CardContent>
            <CardFooter>
              <CardArrow />
            </CardFooter>
          </Card>
        );
      case "import":
        return (
          <MissionTile
            icon={Import}
            label="Import mission pack"
            variant="empty"
            onPress={onPress}
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
