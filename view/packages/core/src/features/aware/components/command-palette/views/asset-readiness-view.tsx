"use no memo";

import {
  Accordion,
  AccordionContent,
  AccordionCount,
  AccordionIndicator,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
} from "@hydris/ui/accordion";
import { Badge, type BadgeVariant } from "@hydris/ui/badge";
import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { useKeyedListNav } from "@hydris/ui/command-palette/use-keyed-list-nav";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import type { Entity } from "@projectqai/proto/world";
import { Radio } from "lucide-react-native";
import { type Dispatch, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { getEntityName } from "../../../../../lib/api/use-track-utils";
import { useAssets } from "../../../hooks/use-asset-readiness";
import {
  type AssetReadiness,
  deriveAssetReadiness,
  gateValue,
  worstBlocker,
} from "../../../utils/asset-readiness";
import { READINESS_VISUAL } from "../../../utils/readiness-display";
import { filterAssets } from "../palette-search";

type AssetEntry = { entity: Entity; readiness: AssetReadiness };

type Row =
  | { kind: "header"; group: string; key: string }
  | { kind: "asset"; key: string; entry: AssetEntry };

const headerKey = (group: string) => `header:${group}`;

function AssetRow({
  entry,
  isHighlighted,
  onPress,
  rowRef,
}: {
  entry: AssetEntry;
  isHighlighted: boolean;
  onPress: () => void;
  rowRef?: React.Ref<View>;
}) {
  const blocker = worstBlocker(entry.readiness);
  const variant: BadgeVariant = blocker ? READINESS_VISUAL[blocker.status].variant : "success";
  const label = blocker ? gateValue(entry.entity, blocker) : "Ready";

  return (
    <Pressable
      ref={rowRef}
      onPress={onPress}
      tabIndex={-1}
      className={cn(
        "min-h-11 flex-row items-center rounded-md pl-[30px] outline-none",
        isHighlighted ? "bg-glass-hover" : "hover:bg-glass active:bg-glass-hover",
      )}
    >
      <View className="flex-1 flex-row items-center gap-2 py-1.5 pr-2">
        <Text
          className={cn(
            "min-w-0 flex-1 font-sans text-sm",
            isHighlighted ? "text-foreground" : "text-foreground/70",
          )}
          numberOfLines={1}
        >
          {getEntityName(entry.entity)}
        </Text>
        <Badge variant={variant} size="sm">
          {label}
        </Badge>
      </View>
    </Pressable>
  );
}

function AssetList({
  notReady,
  ready,
  query,
  onSelect,
}: {
  notReady: AssetEntry[];
  ready: AssetEntry[];
  query: string;
  onSelect: (entity: Entity) => void;
}) {
  const [open, setOpen] = useState<string[]>(() =>
    notReady.length === 0 ? ["notReady", "ready"] : ["notReady"],
  );

  const groups = useMemo(
    () =>
      [
        { group: "notReady", label: "Not ready", entries: notReady },
        { group: "ready", label: "Ready", entries: ready },
      ].filter(({ entries }) => entries.length > 0),
    [notReady, ready],
  );

  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap(({ group, entries }): Row[] => [
        { kind: "header", group, key: headerKey(group) },
        ...(open.includes(group)
          ? entries.map((entry): Row => ({ kind: "asset", key: entry.entity.id, entry }))
          : []),
      ]),
    [groups, open],
  );

  const { setHighlightedKey, highlightedIndex, setHighlightedEl } = useKeyedListNav({
    rows,
    fallbackKey: rows.find((row) => row.kind === "asset")?.key,
  });

  const highlightedKey = rows[highlightedIndex]?.key;

  const [lastQuery, setLastQuery] = useState(query);

  if (query !== lastQuery) {
    setLastQuery(query);
    setHighlightedKey(null);
  }

  const toggle = useCallback(
    (group: string) =>
      setOpen((o) => (o.includes(group) ? o.filter((g) => g !== group) : [...o, group])),
    [],
  );

  useKeyboardShortcut(
    "Enter",
    useCallback(() => {
      const row = rows[highlightedIndex];

      if (!row) return false;

      if (row.kind === "header") toggle(row.group);
      else onSelect(row.entry.entity);

      return true;
    }, [highlightedIndex, rows, onSelect, toggle]),
    { priority: 200 },
  );

  return (
    <ScrollShadow size="sm" className="flex-1">
      <ScrollView className="flex-1 select-none" showsVerticalScrollIndicator={false}>
        <Accordion type="multiple" value={open} onValueChange={setOpen} className="p-2">
          {groups.map(({ group, label, entries }) => {
            const headerHighlighted = highlightedKey === headerKey(group);

            return (
              <AccordionItem key={group} value={group}>
                <AccordionTrigger
                  highlighted={headerHighlighted}
                  ref={headerHighlighted ? setHighlightedEl : undefined}
                >
                  <AccordionIndicator />
                  <AccordionTitle>{label}</AccordionTitle>
                  <AccordionCount>{entries.length}</AccordionCount>
                </AccordionTrigger>
                <AccordionContent className="px-1 pb-1">
                  {entries.map((entry) => {
                    const highlighted = highlightedKey === entry.entity.id;

                    return (
                      <AssetRow
                        key={entry.entity.id}
                        entry={entry}
                        isHighlighted={highlighted}
                        onPress={() => onSelect(entry.entity)}
                        rowRef={highlighted ? setHighlightedEl : undefined}
                      />
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </ScrollView>
    </ScrollShadow>
  );
}

export function AssetReadinessView({
  dispatch,
  query,
}: {
  dispatch: Dispatch<PaletteAction>;
  query: string;
}) {
  const t = useThemeColors();
  const assets = useAssets();

  const { notReady, ready } = useMemo(() => {
    const byName = (a: AssetEntry, b: AssetEntry) =>
      getEntityName(a.entity).localeCompare(getEntityName(b.entity));

    const entries: AssetEntry[] = filterAssets(assets, query).map((entity) => ({
      entity,
      readiness: deriveAssetReadiness(entity),
    }));

    return {
      notReady: entries.filter((e) => !e.readiness.ready).sort(byName),
      ready: entries.filter((e) => e.readiness.ready).sort(byName),
    };
  }, [assets, query]);

  const openAsset = useCallback(
    (entity: Entity) =>
      dispatch({
        type: "push",
        mode: { kind: "asset", entityId: entity.id },
      }),
    [dispatch],
  );

  if (assets.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Radio size={32} strokeWidth={1} color={t.iconMuted} />
        <Text className="text-muted-foreground text-center font-sans text-sm">No assets</Text>
      </View>
    );
  }

  return <AssetList notReady={notReady} ready={ready} query={query} onSelect={openAsset} />;
}
