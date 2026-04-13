import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import uFuzzy from "@leeoniya/ufuzzy";
import type { LucideIcon } from "lucide-react-native";
import { Search } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

const uf = new uFuzzy({ intraMode: 1 });

export type EntityItem = {
  id: string;
  name: string;
  isOnline: boolean;
  subtitle?: string;
};

type Props = {
  entities: EntityItem[];
  icon: LucideIcon;
  emptyLabel: string;
  placeholder: string;
  onSelect: (id: string) => void;
};

export function EntityPickerList({
  entities,
  icon: Icon,
  emptyLabel,
  placeholder,
  onSelect,
}: Props) {
  const t = useThemeColors();
  const [searchQuery, setSearchQuery] = useState("");

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

  return (
    <View>
      <View className="h-12 flex-row items-center gap-2.5 px-4">
        <Search size={18} strokeWidth={2} color={t.iconMuted} />
        <TextInput
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
              {entities.length === 0 ? `No ${emptyLabel} available` : "No matches found"}
            </Text>
          </View>
        ) : (
          filtered.map((entity) => (
            <Pressable
              key={entity.id}
              onPress={() => onSelect(entity.id)}
              tabIndex={-1}
              className="active:bg-surface-overlay/8 hover:bg-surface-overlay/5 flex-row items-center gap-3 px-4 py-3"
            >
              <View className="bg-surface-overlay/6 size-8 items-center justify-center rounded">
                <Icon size={16} strokeWidth={2} color={t.iconMuted} />
              </View>
              <View className="flex-1">
                <HighlightText
                  text={entity.name}
                  ranges={entity.ranges}
                  className="font-sans-medium text-foreground/80 text-sm"
                  highlightClassName="text-blue-foreground"
                />
                {entity.subtitle && (
                  <Text className="text-muted-foreground font-mono text-xs">{entity.subtitle}</Text>
                )}
              </View>
              <View className="flex-row items-center gap-1.5">
                <View
                  className={cn(
                    "size-1.5 rounded-full",
                    entity.isOnline ? "bg-green" : "bg-foreground/60",
                  )}
                />
                <Text className="text-muted-foreground font-mono text-xs">
                  {entity.isOnline ? "online" : "offline"}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}
