import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import type { Category, PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { PaletteRow } from "@hydris/ui/command-palette/palette-row";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { HoldFill } from "@hydris/ui/hold-fill";
import { useHoldToConfirm } from "@hydris/ui/hooks/use-hold-to-confirm";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import { Tag } from "@hydris/ui/tag";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { ChevronRight, Eye, LayoutGrid, Search, Settings } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

const DRILLDOWN_SUBCATEGORIES = new Set(["overlay"]);
const DRILLDOWN_LABELS: Record<string, string> = {
  overlay: "Toggle overlays",
};

import { useEntityStore } from "../../../store/entity-store";
import { UNKNOWN_ICON } from "../../../utils/entity-helpers";
import { type Command, MISSION_IMPORT_COMMAND_ID, PINNED_COMMAND_IDS } from "../command-registry";
import { EntityRow, TruncationHint, useSelectEntity } from "../entity-list";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  classifyEntity,
  COMMAND_SUBCATEGORIES,
  DIMENSION_ICON,
  type DimensionGroup,
  groupByAssetCategory,
} from "../palette-helpers";
import {
  type ConfigurableHit,
  searchCommands,
  searchConfigurables,
  searchEntities,
} from "../palette-search";
import { MissionView } from "./mission-view";
import { TracksView } from "./tracks-view";

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
  const Icon = DIMENSION_ICON[group.battleDimension ?? group.dimension] ?? UNKNOWN_ICON;
  return (
    <PaletteRow ref={ref} icon={Icon} highlighted={isHighlighted} onPress={onPress}>
      <View className="flex-1">
        <Text className="font-sans-medium text-foreground text-sm">{group.label}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-muted-foreground font-mono text-xs tabular-nums">{group.count}</Text>
        <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />
      </View>
    </PaletteRow>
  );
}

const HOLD_DURATION_MS = 2000;

function HoldToConfirmRow({
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

  const { progress, remaining, onPressIn, onPressOut } = useHoldToConfirm({
    onConfirm: () => onExecute(command),
    duration: HOLD_DURATION_MS,
    active: isHighlighted,
  });

  return (
    <Pressable
      ref={ref}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      tabIndex={-1}
      testID={`command-${command.id}`}
      accessible
      accessibilityRole="button"
      className={cn(
        "relative cursor-pointer flex-row items-center gap-3 overflow-hidden px-4 py-3 select-none",
        isHighlighted ? "bg-surface-overlay/8" : "hover:bg-surface-overlay/5",
      )}
    >
      <HoldFill
        progress={progress}
        holding={remaining !== null}
        duration={HOLD_DURATION_MS}
        className="bg-destructive/45"
      />
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
        {command.description && (
          <Text className="text-muted-foreground text-11 font-mono">{command.description}</Text>
        )}
      </View>
      <Tag>{remaining !== null ? `${(remaining / 1000).toFixed(1)}s` : "hold"}</Tag>
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

  if (command.holdToConfirm) {
    return (
      <HoldToConfirmRow
        ref={ref}
        command={command}
        ranges={ranges}
        isHighlighted={isHighlighted}
        onExecute={onExecute}
      />
    );
  }

  return (
    <Pressable
      ref={ref}
      onPress={() => onExecute(command)}
      tabIndex={-1}
      testID={`command-${command.id}`}
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
        {command.description && (
          <Text className="text-muted-foreground text-11 font-mono">{command.description}</Text>
        )}
      </View>
      {command.shortcut && Platform.OS === "web" && <Tag>{command.shortcut}</Tag>}
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
    <PaletteRow ref={ref} icon={Settings} highlighted={isHighlighted} onPress={onPress}>
      <View className="flex-1 gap-1">
        <HighlightText
          text={hit.entityName}
          ranges={ranges}
          className="font-sans-medium text-foreground text-sm"
          highlightClassName="text-blue-foreground"
        />
        <Text className="text-muted-foreground font-mono text-xs">
          {hit.label !== hit.entityName ? hit.label : hit.entityId}
        </Text>
      </View>
      <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />
    </PaletteRow>
  );
}

function CommandGroupDrilldownRow({
  label,
  count,
  isHighlighted,
  onPress,
  ref,
}: {
  label: string;
  count: number;
  isHighlighted: boolean;
  onPress: () => void;
  ref?: React.Ref<View>;
}) {
  const t = useThemeColors();
  return (
    <PaletteRow ref={ref} icon={Eye} highlighted={isHighlighted} onPress={onPress}>
      <View className="flex-1">
        <Text className="font-sans-medium text-foreground text-sm">{label}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-muted-foreground font-mono text-xs tabular-nums">{count}</Text>
        <ChevronRight size={14} strokeWidth={2} color={t.iconMuted} />
      </View>
    </PaletteRow>
  );
}

type RootItem =
  | { type: "section-header"; title: string; key: string }
  | { type: "dimension-group"; group: DimensionGroup; category: Category; key: string }
  | { type: "entity"; entity: Entity; ranges: number[]; key: string }
  | { type: "command"; command: Command; ranges: number[]; key: string }
  | { type: "configurable"; hit: ConfigurableHit; ranges: number[]; key: string }
  | {
      type: "command-group";
      groupId: string;
      groupLabel: string;
      rowLabel: string;
      count: number;
      key: string;
    }
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
  const entities = useEntityStore(useShallow((s) => Array.from(s.entities.values())));
  const handleEntitySelect = useSelectEntity(onClose);
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
  const showMission = !isSearching && activeCategory === "mission";
  const importCommand = commands.find((c) => c.id === MISSION_IMPORT_COMMAND_ID);
  const showAssetGroups = !isSearching && activeCategory === "assets";
  const showTracksList = !isSearching && activeCategory === "tracks";

  const assetGroups = showAssetGroups ? groupByAssetCategory(entities) : [];

  const items: RootItem[] = [];

  if (showCommands) {
    for (const id of PINNED_COMMAND_IDS) {
      const cmd = commands.find((c) => c.id === id);
      if (cmd) {
        items.push({ type: "command", command: cmd, ranges: [], key: cmd.id });
      }
    }
    for (const sub of COMMAND_SUBCATEGORIES) {
      const group = commands.filter(
        (c) => c.category === sub.id && !PINNED_COMMAND_IDS.includes(c.id),
      );
      if (group.length === 0) continue;
      if (DRILLDOWN_SUBCATEGORIES.has(sub.id)) {
        items.push({ type: "section-header", title: sub.label, key: `hdr-cmd-${sub.id}` });
        items.push({
          type: "command-group",
          groupId: sub.id,
          groupLabel: sub.label,
          rowLabel: DRILLDOWN_LABELS[sub.id] ?? sub.label,
          count: group.length,
          key: `grp-${sub.id}`,
        });
        continue;
      }
      items.push({ type: "section-header", title: sub.label, key: `hdr-cmd-${sub.id}` });
      for (const cmd of group) {
        items.push({ type: "command", command: cmd, ranges: [], key: cmd.id });
      }
    }
  } else if (!showMission && !showTracksList) {
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

    if (showAssetGroups && assetGroups.length > 0) {
      for (const group of assetGroups) {
        items.push({
          type: "dimension-group",
          group,
          category: activeCategory,
          key: `dim-${group.dimension}`,
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
    } else if (item.type === "command-group") {
      dispatch({
        type: "push",
        mode: { kind: "command-group", groupId: item.groupId, groupLabel: item.groupLabel },
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
    enabled: !showMission && !showTracksList,
  });

  const selectableCount = items.filter(isItemSelectable).length;

  const renderContent = () => {
    if (showMission) {
      return (
        <MissionView
          dispatch={dispatch}
          onImport={importCommand && (() => handleCommandExecute(importCommand))}
        />
      );
    }

    if (showTracksList) return <TracksView query="" onClose={onClose} />;

    if (items.length === 0) {
      return (
        <Empty>
          <EmptyMedia icon={query ? Search : LayoutGrid} />
          <EmptyTitle>{query ? "No results found" : "No entities found"}</EmptyTitle>
          {!query && <EmptyDescription>Connect a data source to get started</EmptyDescription>}
        </Empty>
      );
    }

    return (
      <ScrollShadow size="lg" className="flex-1">
        <FlashList
          ref={listRef}
          data={items}
          onScroll={handleScroll}
          keyExtractor={(item: RootItem) => item.key}
          getItemType={(item: RootItem) => item.type}
          renderItem={({ item, index }: { item: RootItem; index: number }) => {
            if (item.type === "truncation-hint") {
              return <TruncationHint shown={item.shown} total={item.total} />;
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

            if (item.type === "command-group") {
              return (
                <CommandGroupDrilldownRow
                  ref={index === highlightedIndex ? setHighlightedEl : undefined}
                  label={item.rowLabel}
                  count={item.count}
                  isHighlighted={index === highlightedIndex}
                  onPress={() =>
                    dispatch({
                      type: "push",
                      mode: {
                        kind: "command-group",
                        groupId: item.groupId,
                        groupLabel: item.groupLabel,
                      },
                    })
                  }
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
      </ScrollShadow>
    );
  };

  return (
    <>
      <View accessibilityLiveRegion="polite" className="sr-only">
        <Text>
          {selectableCount} {selectableCount === 1 ? "result" : "results"}
        </Text>
      </View>

      <View className="flex-1">{renderContent()}</View>
    </>
  );
}
