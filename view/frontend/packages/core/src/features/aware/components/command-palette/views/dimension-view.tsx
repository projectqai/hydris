import { Badge } from "@hydris/ui/badge";
import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import type { Category } from "@hydris/ui/command-palette/palette-reducer";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { Search } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { getEntityName } from "../../../../../lib/api/use-track-utils";
import { ENTITY_NAV_PARAMS, useUrlParams } from "../../../../../lib/use-url-params";
import { useEntityStore } from "../../../store/entity-store";
import { useMapEngine } from "../../../store/map-engine-store";
import { useSelectionStore } from "../../../store/selection-store";
import {
  getConfigState,
  getConfigStateBadgeVariant,
  getEntityIcon,
} from "../../../utils/entity-helpers";
import { classifyEntity, getBattleDimension, getFunctionCategory } from "../palette-helpers";
import { searchEntities } from "../palette-search";

type ListItem =
  | { type: "section-header"; title: string; key: string }
  | { type: "entity"; entity: Entity; ranges: number[]; key: string }
  | { type: "truncation-hint"; shown: number; total: number; key: string };

const isItemSelectable = (item: ListItem) =>
  item.type !== "section-header" && item.type !== "truncation-hint";

export function DimensionView({
  dimension,
  category,
  query,
  onClose,
}: {
  dimension: string;
  category: Category;
  query: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const entities = useEntityStore((s) => s.entities);
  const select = useSelectionStore((s) => s.select);
  const mapEngine = useMapEngine();
  const { clearParams } = useUrlParams();

  const dimensionEntities = new Map<string, Entity>();
  for (const [id, entity] of entities) {
    if (classifyEntity(entity) !== category) continue;
    const match =
      category === "assets"
        ? getFunctionCategory(entity) === dimension
        : getBattleDimension(entity) === dimension;
    if (!match) continue;
    dimensionEntities.set(id, entity);
  }

  const { results: searchResults, total: searchTotal } = searchEntities(
    dimensionEntities,
    query,
    null,
    100,
  );

  const items: ListItem[] = [];
  for (const r of searchResults) {
    items.push({
      type: "entity",
      entity: r.item,
      ranges: r.ranges,
      key: r.item.id,
    });
  }
  if (searchResults.length < searchTotal) {
    items.push({
      type: "truncation-hint",
      shown: searchResults.length,
      total: searchTotal,
      key: "truncation-hint",
    });
  }

  const handleEntitySelect = (entity: Entity) => {
    clearParams(ENTITY_NAV_PARAMS);
    select(entity.id);
    if (entity.geo) {
      const currentZoom = mapEngine.getView()?.zoom ?? 10;
      mapEngine.flyTo(
        entity.geo.latitude,
        entity.geo.longitude,
        entity.geo.altitude ?? 0,
        1.5,
        Math.max(currentZoom, 16),
      );
    }
    onClose();
  };

  const handleActivate = (item: ListItem) => {
    if (item.type === "entity") {
      handleEntitySelect(item.entity);
    }
  };

  const { highlightedIndex, listRef, setHighlightedEl, handleScroll } = useListNav({
    items,
    isSelectable: isItemSelectable,
    onActivate: handleActivate,
    resetKey: `${dimension}:${category}:${query}`,
    stateKey: `dimension:${dimension}:${category}`,
  });

  return (
    <View className="flex-1">
      {items.length === 0 ? (
        <EmptyState icon={Search} title={query ? "No results found" : "No entities"} />
      ) : (
        <FlashList
          ref={listRef}
          data={items}
          onScroll={handleScroll}
          keyExtractor={(item: ListItem) => item.key}
          renderItem={({ item, index }: { item: ListItem; index: number }) => {
            if (item.type === "truncation-hint") {
              return (
                <View className="px-4 py-3">
                  <Text className="text-muted-foreground text-center font-mono text-xs tabular-nums">
                    Showing {item.shown} of {item.total}
                  </Text>
                </View>
              );
            }
            if (item.type === "section-header") {
              return (
                <View className="px-4 pt-4 pb-1.5">
                  <Text className="text-11 text-on-surface/70 font-mono tracking-widest uppercase">
                    {item.title}
                  </Text>
                </View>
              );
            }
            const entity = item.entity;
            const configState = getConfigState(entity);
            const Icon = getEntityIcon(entity);
            const isHighlighted = index === highlightedIndex;

            return (
              <Pressable
                ref={isHighlighted ? setHighlightedEl : undefined}
                onPress={() => handleEntitySelect(entity)}
                tabIndex={-1}
                className={cn(
                  "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
                  isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
                )}
              >
                <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
                  <Icon size={16} strokeWidth={2} color={t.iconMuted} />
                </View>
                <View className="flex-1 gap-1">
                  <HighlightText
                    text={getEntityName(entity)}
                    ranges={item.ranges}
                    className="font-sans-medium text-foreground text-sm"
                    highlightClassName="text-blue-foreground"
                  />
                  {entity.controller?.id && (
                    <Text className="text-muted-foreground font-mono text-xs">
                      {entity.controller.id}
                    </Text>
                  )}
                </View>
                {configState && (
                  <Badge variant={getConfigStateBadgeVariant(configState)} size="sm">
                    {configState}
                  </Badge>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
