import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { Empty, EmptyTitle } from "@hydris/ui/empty-state";
import { useTileMeasure } from "@hydris/ui/lib/tile-layout";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import type { MediaStream } from "@projectqai/proto/world";
import { useCallback, useState } from "react";
import type { ListRenderItemInfo, ViewToken } from "react-native";
import { FlatList, View } from "react-native";

import { MissionTile } from "../../../../mission/components/mission-tile";
import { NoisePlaceholder } from "../../../../mission/components/noise-placeholder";
import { awaitsSetup } from "../../../../mission/sources";
import { useEntityStore } from "../../../store/entity-store";
import { getEntityIcon } from "../../../utils/entity-helpers";
import { hasSchemaFields } from "../../schema-form";
import { getStreamLabel, VideoFeed, VideoFeedLabel } from "../../video-stream/video-feed";
import { DeviceHeader } from "./device-header";

const SET_UP_LABEL = "Set up camera";

function CameraStreams({ cameraId, streams }: { cameraId: string; streams: MediaStream[] }) {
  const [visibleUrls, setVisibleUrls] = useState<ReadonlySet<string>>(new Set());
  const list = useTileMeasure();
  const entryHeader = useTileMeasure();
  const isMeasured = list.size.height > 0 && entryHeader.size.height > 0;
  const nextHeaderPeek = streams.length > 1 ? entryHeader.size.height : 0;
  const entryHeight = list.size.height - nextHeaderPeek;

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<MediaStream>[] }) =>
      setVisibleUrls(new Set(viewableItems.map((token) => token.item.url))),
    [],
  );

  const renderStream = ({ item, index }: ListRenderItemInfo<MediaStream>) => {
    const detectionCameraId = index === 0 ? cameraId : undefined;

    return (
      <View
        role="group"
        aria-label={getStreamLabel(item, index)}
        className="px-4 pb-4"
        style={isMeasured ? { height: entryHeight } : undefined}
      >
        <View onLayout={index === 0 ? entryHeader.onLayout : undefined} className="pt-4 pb-1">
          <VideoFeedLabel stream={item} index={index} />
        </View>
        <VideoFeed
          entityId={cameraId}
          stream={item}
          index={index}
          objectFit="contain"
          enabled={isMeasured && visibleUrls.has(item.url)}
          cameraEntityId={detectionCameraId}
          className="flex-1"
        />
      </View>
    );
  };

  return (
    <ScrollShadow size="sm" className="flex-1">
      <FlatList
        data={streams}
        extraData={[visibleUrls, entryHeight]}
        keyExtractor={(stream) => stream.url}
        onViewableItemsChanged={onViewableItemsChanged}
        onLayout={list.onLayout}
        className="flex-1"
        renderItem={renderStream}
      />
    </ScrollShadow>
  );
}

export function CameraView({
  entityId,
  dispatch,
}: {
  entityId: string;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const camera = useEntityStore((s) => s.entities.get(entityId));
  const needsSetup = !!camera && awaitsSetup(camera);

  const openSetup = () => dispatch({ type: "push", mode: { kind: "setup", entityId } });

  const { highlightedIndex } = useListNav({
    items: needsSetup ? [SET_UP_LABEL] : [],
    onActivate: openSetup,
    resetKey: `camera:${entityId}`,
    initialIndex: -1,
  });

  if (!camera) {
    return (
      <Empty>
        <EmptyTitle>Camera no longer exists</EmptyTitle>
      </Empty>
    );
  }

  const streams = camera.camera?.streams ?? [];

  return (
    <View className="flex-1">
      <DeviceHeader
        entity={camera}
        onSettings={
          hasSchemaFields(camera.configurable?.schema)
            ? () => dispatch({ type: "push", mode: { kind: "settings", entityId } })
            : undefined
        }
      />
      <View className="bg-surface-overlay/6 mx-4 h-px" />
      {needsSetup ? (
        <View className="m-4 flex-1">
          <MissionTile
            icon={getEntityIcon(camera)}
            label={SET_UP_LABEL}
            variant="empty"
            onPress={openSetup}
            highlighted={highlightedIndex === 0}
          />
        </View>
      ) : streams.length > 0 ? (
        <CameraStreams cameraId={camera.id} streams={streams} />
      ) : (
        <View className="m-4 flex-1 overflow-hidden rounded">
          <NoisePlaceholder />
          <Empty>
            <EmptyTitle>No stream</EmptyTitle>
          </Empty>
        </View>
      )}
    </View>
  );
}
