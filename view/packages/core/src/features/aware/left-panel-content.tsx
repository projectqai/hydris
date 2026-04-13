import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { SegmentedControl } from "@hydris/ui/segmented-control";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { AlertTriangle, MapPin } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { ENTITY_NAV_PARAMS, useUrlParams } from "../../lib/use-url-params";
import { EntityCard } from "./entity-track-card";
import {
  selectAssetCount,
  selectAssets,
  selectTrackCount,
  selectTracks,
  useEntityStore,
} from "./store/entity-store";
import { type ListMode, useLeftPanelStore } from "./store/left-panel-store";
import { useMapEngine } from "./store/map-engine-store";
import { useSelectionStore } from "./store/selection-store";

export function CollapsedStats() {
  const t = useThemeColors();
  const listMode = useLeftPanelStore((s) => s.listMode);
  const trackCount = useEntityStore(selectTrackCount);
  const assetCount = useEntityStore(selectAssetCount);
  const count = listMode === "tracks" ? trackCount : assetCount;
  const alertCount = 0;

  const label = listMode === "tracks" ? "Tracks" : "Assets";

  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-row items-center gap-1.5">
        <AlertTriangle size={15} color={t.iconSubtle} strokeWidth={2} />
        <Text className="font-sans-semibold text-foreground/80 text-xs">{alertCount} Alerts</Text>
      </View>

      <Text className="text-foreground/80 text-xl leading-none">•</Text>

      <View className="flex-row items-center gap-1.5">
        <MapPin size={15} color={t.iconSubtle} strokeWidth={2} />
        <Text className="font-sans-semibold text-foreground/80 text-xs">
          {count} {label}
        </Text>
      </View>
    </View>
  );
}

const TABS = [
  { id: "tracks" as const, label: "Tracks" },
  { id: "assets" as const, label: "Assets" },
];

const PAGE_SIZE = 200;

export function LeftPanelContent() {
  const listMode = useLeftPanelStore((s) => s.listMode);
  const setListMode = useLeftPanelStore((s) => s.setListMode);
  const tracks = useEntityStore(selectTracks);
  const assets = useEntityStore(selectAssets);
  const select = useSelectionStore((s) => s.select);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const mapEngine = useMapEngine();
  const { clearParams } = useUrlParams();

  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const listRef = useRef<any>(null);

  const onTabChange = (mode: ListMode) => {
    setDisplayCount(PAGE_SIZE);
    setListMode(mode);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  };

  const handleItemPress = (entity: Entity) => {
    clearParams(ENTITY_NAV_PARAMS);

    if (selectedEntityId === entity.id) {
      select(null);
    } else {
      select(entity.id);
      if (entity.geo) {
        const currentZoom = mapEngine.getView()?.zoom ?? 10;
        const targetZoom = Math.max(currentZoom, 14);
        mapEngine.flyTo(
          entity.geo.latitude,
          entity.geo.longitude,
          entity.geo.altitude ?? 0,
          1.5,
          targetZoom,
        );
      }
    }
  };

  const handleLoadMore = () => {
    setDisplayCount((c) => c + PAGE_SIZE);
  };

  const entities = listMode === "tracks" ? tracks : assets;
  const displayedEntities = useMemo(
    () => entities.slice(0, displayCount),
    [entities, displayCount],
  );
  const hasMore = displayedEntities.length < entities.length;

  return (
    <View className="flex-1 select-none">
      <SegmentedControl tabs={TABS} activeTab={listMode} onTabChange={onTabChange} />
      {displayedEntities.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={listMode === "tracks" ? "No tracks detected" : "No assets available"}
          subtitle={
            listMode === "tracks" ? "Waiting for tracked objects" : "No static assets on map"
          }
        />
      ) : (
        <FlashList
          ref={listRef}
          data={displayedEntities}
          extraData={selectedEntityId}
          renderItem={({ item }) => (
            <EntityCard
              entity={item}
              isSelected={selectedEntityId === item.id}
              onPress={() => handleItemPress(item)}
            />
          )}
          keyExtractor={(item) => item.id}
          drawDistance={500}
          contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 12 }}
          showsVerticalScrollIndicator
          onEndReached={hasMore ? handleLoadMore : undefined}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}
