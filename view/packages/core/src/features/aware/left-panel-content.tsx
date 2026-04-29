import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { SegmentedControl } from "@hydris/ui/segmented-control";
import type { Entity } from "@projectqai/proto/world";
import { SortField } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { AlertTriangle, ArrowDownAZ, ArrowUpAZ, Check, MapPin } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as DropdownMenu from "zeego/dropdown-menu";

import { ENTITY_NAV_PARAMS, useUrlParams } from "../../lib/use-url-params";
import { EntityCard } from "./entity-track-card";
import {
  selectAssetCount,
  selectAssets,
  selectTrackCount,
  selectTracks,
  useEntityStore,
} from "./store/entity-store";
import {
  DEFAULT_SORT,
  type ListMode,
  type SortConfig,
  useLeftPanelStore,
} from "./store/left-panel-store";
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

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: SortField.SortFieldLabel, label: "Name" },
  { field: SortField.SortFieldPriority, label: "Priority" },
  { field: SortField.SortFieldLifetimeFresh, label: "Last Updated" },
  { field: SortField.SortFieldLifetimeFrom, label: "Created" },
  { field: SortField.SortFieldGeoAltitude, label: "Altitude" },
  { field: SortField.SortFieldClassificationIdentity, label: "Identity" },
  { field: SortField.SortFieldBearingAzimuth, label: "Bearing" },
  { field: SortField.SortFieldLinkLastSeen, label: "Last Seen" },
  { field: SortField.SortFieldLinkQuality, label: "Link Quality" },
  { field: SortField.SortFieldPowerBatteryCharge, label: "Battery" },
  { field: SortField.SortFieldDeviceState, label: "Device State" },
];

function getSortLabel(field: SortField): string {
  return SORT_OPTIONS.find((o) => o.field === field)?.label ?? "Name";
}

const PAGE_SIZE = 200;

export function LeftPanelContent() {
  const listMode = useLeftPanelStore((s) => s.listMode);
  const setListMode = useLeftPanelStore((s) => s.setListMode);
  const sort = useLeftPanelStore((s) => s.sort);
  const setSort = useLeftPanelStore((s) => s.setSort);
  const tracks = useEntityStore(selectTracks);
  const assets = useEntityStore(selectAssets);
  const select = useSelectionStore((s) => s.select);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const mapEngine = useMapEngine();
  const { clearParams } = useUrlParams();
  const t = useThemeColors();

  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const listRef = useRef<any>(null);

  const isDefaultSort =
    sort.field === DEFAULT_SORT.field && sort.descending === DEFAULT_SORT.descending;

  const onTabChange = (mode: ListMode) => {
    setDisplayCount(PAGE_SIZE);
    setListMode(mode);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  };

  const handleSortSelect = useCallback(
    (newSort: SortConfig) => {
      setSort(newSort);
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
    },
    [setSort],
  );

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

  const SortIcon = sort.descending ? ArrowDownAZ : ArrowUpAZ;

  return (
    <View className="flex-1 select-none">
      <SegmentedControl tabs={TABS} activeTab={listMode} onTabChange={onTabChange} />
      <View className="px-3">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Pressable className="focus-visible:ring-foreground/30 flex-row items-center gap-1.5 self-end rounded-md px-2 py-1.5 outline-none focus-visible:ring-2">
              <SortIcon
                size={14}
                color={isDefaultSort ? t.iconSubtle : t.iconStrong}
                strokeWidth={2}
              />
              <Text
                className={cn(
                  "text-xs",
                  isDefaultSort
                    ? "text-foreground/70 font-sans-medium"
                    : "text-foreground font-sans-semibold",
                )}
              >
                {isDefaultSort ? "Sort" : getSortLabel(sort.field)}
              </Text>
            </Pressable>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            sideOffset={4}
            align="end"
            className="border-border/50 bg-card min-w-[180px] overflow-hidden rounded-lg border py-1 shadow-lg outline-none"
          >
            {SORT_OPTIONS.map((option) => {
              const isActive = sort.field === option.field;
              return (
                <DropdownMenu.CheckboxItem
                  key={option.field.toString()}
                  value={isActive}
                  onValueChange={() =>
                    handleSortSelect({
                      field: option.field,
                      descending: isActive ? !sort.descending : false,
                    })
                  }
                  className="data-[highlighted]:bg-foreground/5 flex cursor-pointer flex-row items-center justify-between px-4 py-2 outline-none"
                >
                  <DropdownMenu.ItemTitle
                    className={cn(
                      "font-sans text-sm",
                      isActive ? "text-foreground font-sans-medium" : "text-foreground/70",
                    )}
                  >
                    {option.label}
                  </DropdownMenu.ItemTitle>
                  {Platform.OS === "web" && (
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} color={t.iconStrong} />
                    </DropdownMenu.ItemIndicator>
                  )}
                </DropdownMenu.CheckboxItem>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </View>
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
