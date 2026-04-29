import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { EmptyState } from "@hydris/ui/empty-state";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { FlashList } from "@shopify/flash-list";
import { Search } from "lucide-react-native";
import { Pressable, View } from "react-native";

import type { Command } from "../command-registry";
import { searchCommands } from "../palette-search";

type ListItem = { type: "command"; command: Command; ranges: number[]; key: string };

export function CommandGroupView({
  groupId,
  query,
  commands,
  onClose,
  initialCommandId,
}: {
  groupId: string;
  query: string;
  commands: Command[];
  onClose: () => void;
  initialCommandId?: string;
}) {
  const t = useThemeColors();
  const groupCommands = commands.filter((c) => c.category === groupId);

  const q = query.trim();
  const items: ListItem[] = q
    ? searchCommands(groupCommands, q, 50).results.map((r) => ({
        type: "command",
        command: r.item,
        ranges: r.ranges,
        key: r.item.id,
      }))
    : groupCommands.map((c) => ({
        type: "command",
        command: c,
        ranges: [],
        key: c.id,
      }));

  const handleActivate = (item: ListItem) => {
    item.command.action();
    onClose();
  };

  const suggestedIndex = initialCommandId
    ? items.findIndex((item) => item.command.id === initialCommandId)
    : undefined;

  const { highlightedIndex, listRef, setHighlightedEl, handleScroll } = useListNav({
    items,
    onActivate: handleActivate,
    resetKey: `${groupId}:${query}`,
    stateKey: `command-group:${groupId}`,
    initialIndex: suggestedIndex !== undefined && suggestedIndex >= 0 ? suggestedIndex : undefined,
  });

  return (
    <View className="flex-1">
      {items.length === 0 ? (
        <EmptyState icon={Search} title="No results found" />
      ) : (
        <FlashList
          ref={listRef}
          data={items}
          onScroll={handleScroll}
          keyExtractor={(item: ListItem) => item.key}
          renderItem={({ item, index }: { item: ListItem; index: number }) => {
            const Icon = item.command.icon;
            const isHighlighted = index === highlightedIndex;
            return (
              <Pressable
                ref={isHighlighted ? setHighlightedEl : undefined}
                onPress={() => handleActivate(item)}
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
                    text={item.command.label}
                    ranges={item.ranges}
                    className="font-sans-medium text-foreground text-sm"
                    highlightClassName="text-blue-foreground"
                  />
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
