import { useKeyedListNav } from "@hydris/ui/command-palette/use-keyed-list-nav";
import { useTileMeasure } from "@hydris/ui/lib/tile-layout";
import { cn } from "@hydris/ui/lib/utils";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import type { PropsWithChildren, Ref } from "react";
import { createContext, use } from "react";
import { ScrollView, Text, View } from "react-native";

import type { Columns } from "./mission-tile-columns";
import { fitColumns } from "./mission-tile-columns";

type GridPartProps = PropsWithChildren<{ className?: string }>;

const COLUMN_WIDTHS: Record<Columns, string> = { 1: "w-full", 2: "w-1/2", 3: "w-1/3" };

const MissionTileGridContext = createContext<Columns | null>(null);

export function useTileColumns(tileCount: number) {
  const { size, onLayout } = useTileMeasure();

  return { columns: fitColumns(tileCount, size.width), onLayout };
}

function getGroupStarts<T>(tiles: readonly T[], groupOf: (tile: T) => string): boolean[] {
  return tiles.map((tile, i) => {
    const prev = tiles[i - 1];

    return !prev || groupOf(prev) !== groupOf(tile);
  });
}

function cellsWithGroupRowBreaks(starts: boolean[], columns: Columns) {
  let cell = 0;

  return starts.map((start) => {
    if (start) cell = Math.ceil(cell / columns) * columns;

    return cell++;
  });
}

export function byHeading(a: string | undefined, b: string | undefined): number {
  return Number(!a) - Number(!b) || (a ?? "").localeCompare(b ?? "");
}

export function useTileGridNav<T extends { key: string }>({
  tiles,
  groupOf,
  isSelectable,
  onActivate,
  guard,
}: {
  tiles: readonly T[];
  groupOf?: (tile: T) => string;
  isSelectable?: (tile: T) => boolean;
  onActivate: (tile: T) => void;
  guard?: () => boolean;
}) {
  const grid = useTileColumns(tiles.length);
  const groupStarts = groupOf && getGroupStarts(tiles, groupOf);

  const { highlightedKey, setHighlightedEl } = useKeyedListNav({
    rows: tiles,
    guard,
    columns: grid.columns,
    cells: groupStarts && cellsWithGroupRowBreaks(groupStarts, grid.columns),
    isSelectable,
    onActivate,
  });

  return {
    grid,
    highlightedKey,
    itemRef: (key: string) => (key === highlightedKey ? setHighlightedEl : undefined),
    startsGroup: (index: number) => !!groupStarts?.[index],
  };
}

export function MissionTileGrid({
  columns,
  onLayout,
  className,
  children,
}: GridPartProps & ReturnType<typeof useTileColumns>) {
  return (
    <ScrollShadow size="sm" className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName={cn("grow flex-row flex-wrap content-stretch p-3", className)}
        onLayout={onLayout}
      >
        <MissionTileGridContext value={columns}>{children}</MissionTileGridContext>
      </ScrollView>
    </ScrollShadow>
  );
}

export function MissionTileGridHeading({ className, children }: GridPartProps) {
  return (
    <View className={cn("w-full px-1 pt-2 pb-1", className)}>
      <Text accessibilityRole="header" className="text-muted-foreground font-mono text-xs">
        {children}
      </Text>
    </View>
  );
}

export function MissionTileGridItem({
  ref,
  className,
  children,
}: GridPartProps & { ref?: Ref<View> }) {
  const columns = use(MissionTileGridContext);

  if (!columns) throw new Error("MissionTileGridItem must be rendered inside a MissionTileGrid");

  return (
    <View ref={ref} className={cn("min-h-[206px] p-1", COLUMN_WIDTHS[columns], className)}>
      {children}
    </View>
  );
}
