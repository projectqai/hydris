import { Badge } from "@hydris/ui/badge";
import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import type { Category, PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { ChevronRight, FileQuestion, LayoutGrid, Search, Settings } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";

import { getEntityName } from "../../../../../lib/api/use-track-utils";
import { ENTITY_NAV_PARAMS, useUrlParams } from "../../../../../lib/use-url-params";
import { useEntityStore } from "../../../store/entity-store";
import { useMapEngine } from "../../../store/map-engine-store";
import { useSelectionStore } from "../../../store/selection-store";
import {
  getConfigState,
  getConfigStateBadgeVariant,
  getEntityIcon,
  getEntityTypeLabel,
} from "../../../utils/entity-helpers";
import type { Command } from "../command-registry";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  classifyEntity,
  COMMAND_SUBCATEGORIES,
  DIMENSION_ICON,
  type DimensionGroup,
  groupByFunctionCategory,
} from "../palette-helpers";
import {
  type ConfigurableHit,
  searchCommands,
  searchConfigurables,
  searchEntities,
} from "../palette-search";

function DimensionGroupRow({
  group,
  isHighlighted,
  onPress,
  ref,
}: {
  group: DimensionGroup;
  isHighlighted: boolean;
  onPress: () => void;
  ref?: React.Ref<View>;
}) {
  const t = useThemeColors();
  const Icon = DIMENSION_ICON[group.battleDimension ?? group.dimension] ?? FileQuestion;
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      tabIndex={-1}
      className={cn(
        "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
        isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
      )}
    >
      <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
        <Icon size={16} strokeWidth={2} color={t.iconMuted} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-medium text-foreground text-sm">{group.label}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-muted-foreground font-mono text-xs tabular-nums">{group.count}</Text>
        <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />
      </View>
    </Pressable>
  );
}

function EntityRow({
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
  const t = useThemeColors();
  const configState = getConfigState(entity);
  const typeLabel = getEntityTypeLabel(entity);
  const Icon = getEntityIcon(entity);
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
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
      {configState && (
        <Badge variant={getConfigStateBadgeVariant(configState)} size="sm">
          {configState}
        </Badge>
      )}
    </Pressable>
  );
}

function CommandRow({
  command,
  ranges,
  isHighlighted,
  onExecute,
  ref,
}: {
  command: Command;
  ranges: number[];
  isHighlighted: boolean;
  onExecute: (c: Command) => void;
  ref?: React.Ref<View>;
}) {
  const t = useThemeColors();
  const Icon = command.icon;
  return (
    <Pressable
      ref={ref}
      onPress={() => onExecute(command)}
      tabIndex={-1}
      className={cn(
        "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
        isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
      )}
    >
      <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
        <Icon size={16} strokeWidth={2} color={t.iconMuted} />
      </View>
      <View className="flex-1">
        <HighlightText
          text={command.label}
          ranges={ranges}
          className="font-sans-medium text-foreground text-sm"
          highlightClassName="text-blue-foreground"
        />
      </View>
      {command.shortcut && Platform.OS === "web" && (
        <View className="bg-surface-overlay/6 h-4 items-center justify-center rounded px-1">
          <Text className="text-11 text-on-surface/70 font-mono leading-none">
            {command.shortcut}
          </Text>
        </View>
      )}
      {command.mode && <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />}
    </Pressable>
  );
}

function ConfigurableRow({
  hit,
  ranges,
  isHighlighted,
  onPress,
  ref,
}: {
  hit: ConfigurableHit;
  ranges: number[];
  isHighlighted: boolean;
  onPress: () => void;
  ref?: React.Ref<View>;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      tabIndex={-1}
      className={cn(
        "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
        isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
      )}
    >
      <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
        <Settings size={16} strokeWidth={2} color={t.iconMuted} />
      </View>
      <View className="flex-1 gap-1">
        <HighlightText
          text={hit.label}
          ranges={ranges}
          className="font-sans-medium text-foreground text-sm"
          highlightClassName="text-blue-foreground"
        />
        <Text className="text-muted-foreground font-mono text-xs">{hit.entityName}</Text>
      </View>
      <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />
    </Pressable>
  );
}

type RootItem =
  | { type: "section-header"; title: string; key: string }
  | { type: "dimension-group"; group: DimensionGroup; category: Category; key: string }
  | { type: "entity"; entity: Entity; ranges: number[]; key: string }
  | { type: "command"; command: Command; ranges: number[]; key: string }
  | { type: "configurable"; hit: ConfigurableHit; ranges: number[]; key: string }
  | { type: "truncation-hint"; shown: number; total: number; key: string };

const isItemSelectable = (item: RootItem) =>
  item.type !== "section-header" && item.type !== "truncation-hint";

export function RootView({
  query,
  activeCategory,
  commands,
  dispatch,
  onClose,
}: {
  query: string;
  activeCategory: Category;
  commands: Command[];
  dispatch: React.Dispatch<PaletteAction>;
  onClose: () => void;
}) {
  const entities = useEntityStore((s) => s.entities);
  const select = useSelectionStore((s) => s.select);
  const mapEngine = useMapEngine();
  const { clearParams } = useUrlParams();
  const isSearching = query.trim().length > 0;

  const { results: commandResults, total: commandTotal } = searchCommands(commands, query);
  const { results: entityResults, total: entityTotal } = searchEntities(
    entities,
    query,
    isSearching ? null : activeCategory,
  );
  const { results: configurableResults } = searchConfigurables(entities, query);

  const handleCommandExecute = (command: Command) => {
    if (command.mode) {
      dispatch({ type: "push", mode: command.mode });
      return;
    }
    command.action();
    onClose();
  };

  const showCommands = !isSearching && activeCategory === "commands";
  const showFunctionGroups = !isSearching && activeCategory === "assets";
  const showTracksList = !isSearching && activeCategory === "tracks";

  const functionGroups = showFunctionGroups ? groupByFunctionCategory(entities) : [];

  const items: RootItem[] = [];

  if (showCommands) {
    const configCmd = commands.find((c) => c.category === "configuration");
    if (configCmd) {
      items.push({ type: "command", command: configCmd, ranges: [], key: configCmd.id });
    }
    for (const sub of COMMAND_SUBCATEGORIES) {
      const group = commands.filter((c) => c.category === sub.id);
      if (group.length === 0) continue;
      items.push({ type: "section-header", title: sub.label, key: `hdr-cmd-${sub.id}` });
      for (const cmd of group) {
        items.push({ type: "command", command: cmd, ranges: [], key: cmd.id });
      }
    }
  } else {
    if (commandResults.length > 0) {
      items.push({ type: "section-header", title: "Commands", key: "hdr-commands" });
      for (const r of commandResults) {
        items.push({ type: "command", command: r.item, ranges: r.ranges, key: r.item.id });
      }
    }

    if (isSearching && configurableResults.length > 0) {
      items.push({ type: "section-header", title: "Configurables", key: "hdr-configurables" });
      for (const r of configurableResults) {
        items.push({
          type: "configurable",
          hit: r.item,
          ranges: r.ranges,
          key: `cfg-${r.item.entityId}`,
        });
      }
    }

    if (showFunctionGroups && functionGroups.length > 0) {
      for (const group of functionGroups) {
        items.push({
          type: "dimension-group",
          group,
          category: activeCategory,
          key: `dim-${group.dimension}`,
        });
      }
    } else if (showTracksList) {
      for (const r of entityResults) {
        items.push({ type: "entity", entity: r.item, ranges: r.ranges, key: r.item.id });
      }
      if (entityResults.length < entityTotal) {
        items.push({
          type: "truncation-hint",
          shown: entityResults.length,
          total: entityTotal,
          key: "truncation-hint",
        });
      }
    } else {
      const byType = new Map<string, { entity: Entity; ranges: number[] }[]>();
      for (const r of entityResults) {
        const cat = classifyEntity(r.item);
        if (!cat) continue;
        const label = CATEGORIES.find((c) => c.id === cat)?.label ?? CATEGORY_LABEL[cat] ?? "Other";
        const arr = byType.get(label);
        if (arr) arr.push({ entity: r.item, ranges: r.ranges });
        else byType.set(label, [{ entity: r.item, ranges: r.ranges }]);
      }

      for (const [label, ents] of byType) {
        items.push({ type: "section-header", title: label, key: `hdr-${label}` });
        for (const e of ents) {
          items.push({ type: "entity", entity: e.entity, ranges: e.ranges, key: e.entity.id });
        }
      }

      const shown = commandResults.length + entityResults.length;
      const total = commandTotal + entityTotal;
      if (shown < total) {
        items.push({ type: "truncation-hint", shown, total, key: "truncation-hint" });
      }
    }
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

  const handleActivate = (item: RootItem) => {
    if (item.type === "command") {
      handleCommandExecute(item.command);
    } else if (item.type === "dimension-group") {
      dispatch({
        type: "push",
        mode: {
          kind: "dimension",
          dimension: item.group.dimension,
          dimensionLabel: item.group.label,
          category: item.category,
        },
      });
    } else if (item.type === "configurable") {
      dispatch({
        type: "push",
        mode: { kind: "config", entityId: item.hit.entityId },
      });
    } else if (item.type === "entity") {
      handleEntitySelect(item.entity);
    }
  };

  const { highlightedIndex, listRef, setHighlightedEl, handleScroll } = useListNav({
    items,
    isSelectable: isItemSelectable,
    onActivate: handleActivate,
    resetKey: `${activeCategory}:${query}`,
    stateKey: "root",
  });

  const selectableCount = items.filter(isItemSelectable).length;

  return (
    <>
      <View accessibilityLiveRegion="polite" className="sr-only">
        <Text>
          {selectableCount} {selectableCount === 1 ? "result" : "results"}
        </Text>
      </View>

      <View className="flex-1">
        {items.length === 0 ? (
          <EmptyState
            icon={query ? Search : LayoutGrid}
            title={query ? "No results found" : "No entities found"}
            subtitle={query ? undefined : "Connect a data source to get started"}
          />
        ) : (
          <FlashList
            ref={listRef}
            data={items}
            onScroll={handleScroll}
            keyExtractor={(item: RootItem) => item.key}
            renderItem={({ item, index }: { item: RootItem; index: number }) => {
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
              if (item.type === "command") {
                return (
                  <CommandRow
                    ref={index === highlightedIndex ? setHighlightedEl : undefined}
                    command={item.command}
                    ranges={item.ranges}
                    isHighlighted={index === highlightedIndex}
                    onExecute={handleCommandExecute}
                  />
                );
              }
              if (item.type === "configurable") {
                return (
                  <ConfigurableRow
                    ref={index === highlightedIndex ? setHighlightedEl : undefined}
                    hit={item.hit}
                    ranges={item.ranges}
                    isHighlighted={index === highlightedIndex}
                    onPress={() =>
                      dispatch({
                        type: "push",
                        mode: {
                          kind: "config",
                          entityId: item.hit.entityId,
                        },
                      })
                    }
                  />
                );
              }
              if (item.type === "dimension-group") {
                return (
                  <DimensionGroupRow
                    ref={index === highlightedIndex ? setHighlightedEl : undefined}
                    group={item.group}
                    isHighlighted={index === highlightedIndex}
                    onPress={() =>
                      dispatch({
                        type: "push",
                        mode: {
                          kind: "dimension",
                          dimension: item.group.dimension,
                          dimensionLabel: item.group.label,
                          category: item.category,
                        },
                      })
                    }
                  />
                );
              }
              return (
                <EntityRow
                  ref={index === highlightedIndex ? setHighlightedEl : undefined}
                  entity={item.entity}
                  ranges={item.ranges}
                  isHighlighted={index === highlightedIndex}
                  onPress={() => handleEntitySelect(item.entity)}
                />
              );
            }}
          />
        )}
      </View>
    </>
  );
}
