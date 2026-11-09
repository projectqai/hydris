import { Badge } from "@hydris/ui/badge";
import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import { PaletteRow } from "@hydris/ui/command-palette/palette-row";
import { useKeyedListNav } from "@hydris/ui/command-palette/use-keyed-list-nav";
import { Empty, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { Search } from "lucide-react-native";
import { Text, View } from "react-native";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { ENTITY_NAV_PARAMS, useUrlParams } from "../../../../lib/use-url-params";
import { getConfigStateBadge, getEntityIcon, getEntityTypeLabel } from "../../utils/entity-helpers";
import { focusEntity } from "../../utils/focus-entity";
import { searchEntities } from "./palette-search";

type ListItem =
  | { type: "entity"; entity: Entity; ranges: number[]; key: string }
  | { type: "truncation-hint"; shown: number; total: number; key: string };

const isItemSelectable = (item: ListItem) => item.type === "entity";

export function useSelectEntity(onClose: () => void) {
  const { clearParams } = useUrlParams();

  return (entity: Entity) => {
    clearParams(ENTITY_NAV_PARAMS);
    focusEntity(entity.id);
    onClose();
  };
}

export function TruncationHint({ shown, total }: { shown: number; total: number }) {
  return (
    <View className="px-4 py-3">
      <Text className="text-muted-foreground text-center font-mono text-xs tabular-nums">
        Showing {shown} of {total}
      </Text>
    </View>
  );
}

export function EntityRow({
  entity,
  ranges,
  isHighlighted,
  onPress,
  ref,
}: {
  entity: Entity;
  ranges: number[];
  isHighlighted: boolean;
  onPress: () => void;
  ref?: React.Ref<View>;
}) {
  const configBadge = getConfigStateBadge(entity);
  const typeLabel = getEntityTypeLabel(entity);

  return (
    <PaletteRow
      ref={ref}
      icon={getEntityIcon(entity)}
      highlighted={isHighlighted}
      onPress={onPress}
    >
      <View className="flex-1 gap-1">
        <HighlightText
          text={getEntityName(entity)}
          ranges={ranges}
          className="font-sans-medium text-foreground text-sm"
          highlightClassName="text-blue-foreground"
        />
        <View className="flex-row items-center gap-2">
          <Text className="text-muted-foreground font-mono text-xs">{typeLabel}</Text>
          {entity.controller?.id && (
            <Text className="text-muted-foreground font-mono text-xs">{entity.controller.id}</Text>
          )}
        </View>
      </View>
      {configBadge && (
        <Badge variant={configBadge.variant} size="sm">
          {configBadge.label}
        </Badge>
      )}
    </PaletteRow>
  );
}

export function EntityList({
  entities,
  query,
  emptyTitle,
  onClose,
}: {
  entities: Entity[];
  query: string;
  emptyTitle: string;
  onClose: () => void;
}) {
  const selectEntity = useSelectEntity(onClose);
  const { results, total } = searchEntities(entities, query, null, 100);

  const items: ListItem[] = results.map((r) => ({
    type: "entity",
    entity: r.item,
    ranges: r.ranges,
    key: r.item.id,
  }));

  if (results.length < total) {
    items.push({
      type: "truncation-hint",
      shown: results.length,
      total,
      key: "truncation-hint",
    });
  }

  const { highlightedIndex, setHighlightedEl } = useKeyedListNav({
    rows: items,
    isSelectable: isItemSelectable,
    onActivate: (item) => {
      if (item.type === "entity") selectEntity(item.entity);
    },
  });

  return (
    <View className="flex-1">
      {items.length === 0 ? (
        <Empty>
          <EmptyMedia icon={Search} />
          <EmptyTitle>{query ? "No results found" : emptyTitle}</EmptyTitle>
        </Empty>
      ) : (
        <ScrollShadow size="sm" className="flex-1">
          <FlashList
            data={items}
            keyExtractor={(item: ListItem) => item.key}
            renderItem={({ item, index }: { item: ListItem; index: number }) => {
              if (item.type === "truncation-hint") {
                return <TruncationHint shown={item.shown} total={item.total} />;
              }

              const isHighlighted = index === highlightedIndex;

              return (
                <EntityRow
                  ref={isHighlighted ? setHighlightedEl : undefined}
                  entity={item.entity}
                  ranges={item.ranges}
                  isHighlighted={isHighlighted}
                  onPress={() => selectEntity(item.entity)}
                />
              );
            }}
          />
        </ScrollShadow>
      )}
    </View>
  );
}
