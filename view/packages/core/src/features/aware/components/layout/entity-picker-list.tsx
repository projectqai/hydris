import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { SEVERITY_DOT } from "@hydris/ui/lib/severity";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import uFuzzy from "@leeoniya/ufuzzy";
import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { Check, Crosshair, Search } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import { getEntityName, isDetectionEntity } from "../../../../lib/api/use-track-utils";
import type { TileVariant } from "../../../mission/provider-state";
import { useOwnState } from "../../../mission/use-mission-state";

const uf = new uFuzzy({ intraMode: 1 });

export type EntityItem = {
  id: string;
  name: string;
  entity: Entity;
  subtitle?: string;
};

export function buildEntityItems(
  entities: Entity[],
  subtitle?: (entity: Entity) => string | undefined,
): EntityItem[] {
  const result: EntityItem[] = [];

  for (const entity of entities) {
    // a detection can carry a matching metric
    if (isDetectionEntity(entity)) continue;
    result.push({
      id: entity.id,
      name: getEntityName(entity),
      entity,
      subtitle: subtitle?.(entity),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

const STATE_DOT: Record<TileVariant, string> = {
  default: SEVERITY_DOT.neutral,
  success: SEVERITY_DOT.success,
  pending: SEVERITY_DOT.pending,
  alert: SEVERITY_DOT.alert,
};

function EntityState({ entity }: { entity: Entity }) {
  const state = useOwnState(entity);

  return (
    <View className="flex-row items-center gap-1.5">
      <View className={cn("size-1.5 rounded-full", STATE_DOT[state.variant])} />
      <Text className="text-muted-foreground font-mono text-xs">{state.label}</Text>
    </View>
  );
}

type Props = {
  entities: EntityItem[];
  icon: LucideIcon;
  itemsLabel: string;
  placeholder: string;
  onSelect: (id: string) => void;
  selectable?: boolean;
  selectedId?: string;
  followsId?: string;
  autoFocus?: boolean;
};

export function EntityPickerList({
  entities,
  icon: Icon,
  itemsLabel,
  placeholder,
  onSelect,
  selectable = false,
  selectedId,
  followsId,
  autoFocus = false,
}: Props) {
  const t = useThemeColors();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<TextInput>(null);

  const filtered = (() => {
    const q = searchQuery.trim();
    if (!q) return entities.map((e) => ({ ...e, ranges: [] as number[] }));
    const haystack = entities.map((e) => e.name);
    const idxs = uf.filter(haystack, q);
    if (!idxs || idxs.length === 0) return [];
    const info = uf.info(idxs, haystack, q);
    const order = uf.sort(info, haystack, q);
    return order.map((i) => {
      const itemIdx = info.idx[i]!;
      return { ...entities[itemIdx]!, ranges: info.ranges[i] ?? [] };
    });
  })();

  const { highlightedIndex, setHighlightedEl } = useListNav({
    items: filtered,
    onActivate: (item) => onSelect(item.id),
    resetKey: searchQuery,
  });

  useEffect(() => {
    if (!autoFocus || Platform.OS !== "web") return;
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  return (
    <View>
      <View className="h-12 flex-row items-center gap-2.5 px-4">
        <Search size={18} strokeWidth={2} color={t.iconMuted} />
        <TextInput
          ref={inputRef}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={placeholder}
          placeholderTextColor={t.placeholder}
          aria-label={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          className="text-foreground flex-1 font-sans text-sm"
          // @ts-expect-error outlineStyle is a React Native Web prop
          style={{ outlineStyle: "none" }}
        />
      </View>
      <View className="bg-surface-overlay/6 h-px" />

      <View>
        {filtered.length === 0 ? (
          <View className="items-center justify-center py-10">
            <Icon size={32} strokeWidth={1} color={t.iconMuted} />
            <Text className="text-muted-foreground mt-2 font-sans text-sm">
              {entities.length === 0 ? `No ${itemsLabel} available` : "No matches found"}
            </Text>
          </View>
        ) : (
          <View
            // @ts-expect-error listbox is a React Native Web role
            role="listbox"
            aria-label={itemsLabel}
          >
            {filtered.map((entity, index) => {
              const isPinned = entity.id === selectedId;
              const isFollowing = !selectedId && entity.id === followsId;
              const isHighlighted = index === highlightedIndex;

              return (
                <Pressable
                  ref={isHighlighted ? setHighlightedEl : undefined}
                  key={entity.id}
                  onPress={() => onSelect(entity.id)}
                  role="option"
                  aria-selected={isHighlighted}
                  tabIndex={-1}
                  className={cn(
                    "active:bg-surface-overlay/8 flex-row items-center gap-3 px-4 py-3",
                    isHighlighted || isPinned || isFollowing
                      ? "bg-surface-overlay/8"
                      : "hover:bg-surface-overlay/5",
                  )}
                >
                  {selectable ? (
                    <View className="w-5 items-center justify-center">
                      {isPinned ? (
                        <Check
                          size={16}
                          strokeWidth={2.5}
                          color={t.controlFgActive}
                          aria-label="Pinned"
                        />
                      ) : isFollowing ? (
                        <Crosshair
                          size={15}
                          strokeWidth={2}
                          color={t.iconMuted}
                          aria-label="Following"
                        />
                      ) : null}
                    </View>
                  ) : (
                    <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
                      <Icon size={16} strokeWidth={2} color={t.iconMuted} />
                    </View>
                  )}
                  <View className="flex-1">
                    <HighlightText
                      text={entity.name}
                      ranges={entity.ranges}
                      className="font-sans-medium text-foreground/80 text-sm"
                      highlightClassName="text-blue-foreground"
                    />
                    {entity.subtitle && (
                      <Text className="text-muted-foreground font-mono text-xs">
                        {entity.subtitle}
                      </Text>
                    )}
                  </View>
                  {(entity.entity.device || entity.entity.configurable) && (
                    <EntityState entity={entity.entity} />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
