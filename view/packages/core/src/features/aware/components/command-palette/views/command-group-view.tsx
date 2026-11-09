import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import { PaletteRow } from "@hydris/ui/command-palette/palette-row";
import { useListNav } from "@hydris/ui/command-palette/use-list-nav";
import { Empty, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import { FlashList } from "@shopify/flash-list";
import { Search } from "lucide-react-native";
import { View } from "react-native";

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
        <Empty>
          <EmptyMedia icon={Search} />
          <EmptyTitle>No results found</EmptyTitle>
        </Empty>
      ) : (
        <ScrollShadow size="sm" className="flex-1">
          <FlashList
            ref={listRef}
            data={items}
            onScroll={handleScroll}
            keyExtractor={(item: ListItem) => item.key}
            renderItem={({ item, index }: { item: ListItem; index: number }) => {
              const isHighlighted = index === highlightedIndex;

              return (
                <PaletteRow
                  ref={isHighlighted ? setHighlightedEl : undefined}
                  icon={item.command.icon}
                  highlighted={isHighlighted}
                  onPress={() => handleActivate(item)}
                >
                  <View className="flex-1">
                    <HighlightText
                      text={item.command.label}
                      ranges={item.ranges}
                      className="font-sans-medium text-foreground text-sm"
                      highlightClassName="text-blue-foreground"
                    />
                  </View>
                </PaletteRow>
              );
            }}
          />
        </ScrollShadow>
      )}
    </View>
  );
}
