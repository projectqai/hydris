"use no memo";

import { Badge } from "@hydris/ui/badge";
import { HighlightText } from "@hydris/ui/command-palette/highlight-text";
import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ChevronRight, Radio, Search, Settings } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { type ConfigStateLabel, getConfigStateBadgeVariant } from "../../utils/entity-helpers";
import { filterConfigTree } from "../command-palette/palette-search";
import type { CategoryGroup, ConfigSelection, DeviceNode } from "./use-config-tree";

function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  )
    return true;
  const role = el.getAttribute("role");
  return role === "switch" || role === "checkbox" || role === "slider";
}

type TreeItem = {
  key: string;
  selection: ConfigSelection;
  label: string;
  icon: DeviceNode["icon"] | null;
  depth: number;
  hasChildren: boolean;
  configState: ConfigStateLabel | null;
  isCategoryHeader?: boolean;
  isConfigurable?: boolean;
  ranges?: number[];
};

function TreeRow({
  item,
  isSelected,
  isHighlighted,
  isExpanded,
  onToggle,
  onSelect,
  ref,
}: {
  item: TreeItem;
  isSelected: boolean;
  isHighlighted: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  ref?: React.Ref<View>;
}) {
  const t = useThemeColors();
  const Icon = item.icon;

  if (item.isCategoryHeader) {
    return (
      <Pressable
        ref={ref}
        onPress={onToggle}
        tabIndex={-1}
        className={cn(
          "min-h-11 flex-row items-center gap-1.5 pr-4 pl-3 outline-none",
          isHighlighted ? "bg-glass-hover" : "hover:bg-glass active:bg-glass-hover",
        )}
      >
        <View className="w-10 items-center">
          <View style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}>
            <ChevronRight size={10} strokeWidth={2} color={t.iconSubtle} />
          </View>
        </View>
        <Text className="font-sans-semibold text-muted-foreground text-xs tracking-wider uppercase">
          {item.label}
        </Text>
      </Pressable>
    );
  }

  const contentPress = item.selection ? onSelect : item.hasChildren ? onToggle : undefined;

  return (
    <Pressable
      ref={ref}
      onPress={contentPress}
      tabIndex={-1}
      className={cn(
        "min-h-11 flex-row items-center pl-3 outline-none",
        isHighlighted
          ? "bg-glass-hover"
          : isSelected
            ? "bg-glass"
            : "hover:bg-glass active:bg-glass-hover",
      )}
    >
      {Array.from({ length: item.depth }, (_, i) => (
        <View key={i} className="w-10 items-center self-stretch">
          <View className="bg-border/70 w-px flex-1" />
        </View>
      ))}

      {item.hasChildren ? (
        <Pressable
          onPress={onToggle}
          tabIndex={-1}
          accessibilityLabel={isExpanded ? "Collapse" : "Expand"}
          className="w-10 items-center justify-center self-stretch outline-none"
        >
          <View style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}>
            <ChevronRight size={11} strokeWidth={2} color={t.iconSubtle} />
          </View>
        </Pressable>
      ) : (
        <View className="w-10" />
      )}

      <View className="flex-1 flex-row items-center gap-2 py-1.5 pr-3">
        {Icon ? (
          <Icon
            size={14}
            strokeWidth={2}
            color={isSelected || isHighlighted ? t.controlFgActive : t.iconDefault}
          />
        ) : (
          <Settings
            size={12}
            strokeWidth={2}
            color={isSelected || isHighlighted ? t.controlFgActive : t.iconDefault}
          />
        )}
        <HighlightText
          text={item.label}
          ranges={item.ranges ?? []}
          className={cn(
            "flex-1 font-sans text-sm",
            isSelected || isHighlighted ? "text-foreground" : "text-foreground/70",
          )}
          highlightClassName="text-blue-foreground"
        />
        {item.configState && (
          <Badge variant={getConfigStateBadgeVariant(item.configState)} size="sm">
            {item.configState}
          </Badge>
        )}
      </View>
    </Pressable>
  );
}

function computeDefaultCollapsed(tree: CategoryGroup[]): Set<string> {
  const collapsed = new Set<string>();

  const walkNodes = (nodes: DeviceNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        collapsed.add(node.entityId);
        walkNodes(node.children);
      }
    }
  };

  for (const category of tree) {
    collapsed.add(`category:${category.category}`);
    walkNodes(category.roots);
  }

  return collapsed;
}

function NoSearchResults() {
  const t = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Search size={32} strokeWidth={1} color={t.iconMuted} />
      <Text className="text-muted-foreground text-center font-sans text-sm">
        No matching devices
      </Text>
    </View>
  );
}

function TreeView({
  tree,
  selection,
  onSelect,
  query,
}: {
  tree: CategoryGroup[];
  selection: ConfigSelection;
  onSelect: (sel: ConfigSelection) => void;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => computeDefaultCollapsed(tree));
  const prevTreeLen = useRef(tree.length);
  useEffect(() => {
    if (prevTreeLen.current === 0 && tree.length > 0) {
      setCollapsed(computeDefaultCollapsed(tree));
    }
    prevTreeLen.current = tree.length;
  }, [tree]);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);

  const isSearching = query.trim().length > 0;
  const searchResult = useMemo(() => filterConfigTree(tree, query), [tree, query]);

  useEffect(() => {
    if (isSearching && searchResult.matches.length > 0) {
      setHighlightedKey(searchResult.matches[0]!.entityId);
    }
  }, [isSearching, searchResult]);

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const rangesByKey = useMemo(() => {
    if (!isSearching) return null;
    const map = new Map<string, number[]>();
    for (const m of searchResult.matches) {
      map.set(m.entityId, m.ranges);
    }
    return map;
  }, [isSearching, searchResult]);

  const rows = useMemo(() => {
    const result: TreeItem[] = [];

    const addNodes = (nodes: DeviceNode[], depth: number) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        const isCollapsed = isSearching ? false : collapsed.has(node.entityId);
        if (
          isSearching &&
          !searchResult.matchedKeys.has(node.entityId) &&
          !searchResult.expandKeys.has(node.entityId)
        )
          continue;
        result.push({
          key: node.entityId,
          selection: { type: "device", entityId: node.entityId },
          label: node.label,
          icon: node.icon,
          depth,
          hasChildren,
          configState: node.configState,
          isConfigurable: node.isConfigurable,
          ranges: rangesByKey?.get(node.entityId),
        });
        if (hasChildren && !isCollapsed) {
          addNodes(node.children, depth + 1);
        }
      }
    };

    for (const category of tree) {
      const categoryKey = `category:${category.category}`;
      const categoryHasChildren = category.roots.length > 0;
      if (isSearching && !searchResult.expandKeys.has(categoryKey)) continue;
      result.push({
        key: categoryKey,
        selection: null,
        label: category.category,
        icon: null,
        depth: 0,
        hasChildren: categoryHasChildren,
        configState: null,
        isCategoryHeader: true,
      });

      if (categoryHasChildren && !isSearching && collapsed.has(categoryKey)) continue;

      addNodes(category.roots, 1);
    }

    return result;
  }, [tree, collapsed, isSearching, searchResult, rangesByKey]);

  const highlightedIndex = useMemo(() => {
    if (highlightedKey) {
      const idx = rows.findIndex((r) => r.key === highlightedKey);
      if (idx >= 0) return idx;
    }
    return rows.length > 0 ? 0 : -1;
  }, [rows, highlightedKey]);

  const setHighlightedEl = useCallback((node: any) => {
    highlightedElRef.current = node;
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0) {
      (highlightedElRef.current as HTMLElement)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlightedIndex]);

  useKeyboardShortcut(
    "ArrowDown",
    useCallback(() => {
      if (isInputFocused()) return false;
      const nextIdx = highlightedIndex + 1;
      if (nextIdx < rows.length) {
        setHighlightedKey(rows[nextIdx]!.key);
      }
      return true;
    }, [highlightedIndex, rows]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "ArrowUp",
    useCallback(() => {
      if (isInputFocused()) return false;
      const nextIdx = highlightedIndex - 1;
      if (nextIdx >= 0) {
        setHighlightedKey(rows[nextIdx]!.key);
      }
      return true;
    }, [highlightedIndex, rows]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "Enter",
    useCallback(() => {
      if (isInputFocused()) return false;
      const item = rows[highlightedIndex];
      if (!item) return false;
      if (item.hasChildren) {
        toggleCollapse(item.key);
        return true;
      }
      if (item.selection) {
        onSelect(item.selection);
        return true;
      }
      return false;
    }, [highlightedIndex, rows, onSelect, toggleCollapse]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "ArrowRight",
    useCallback(() => {
      if (isInputFocused()) return false;
      const rowIdx = rows.findIndex((r) => r.key === highlightedKey);
      if (rowIdx < 0) return false;
      const item = rows[rowIdx]!;
      if (item.hasChildren && collapsed.has(item.key)) {
        toggleCollapse(item.key);
        return true;
      }
      if (item.hasChildren && !collapsed.has(item.key) && rowIdx + 1 < rows.length) {
        const nextRow = rows[rowIdx + 1]!;
        if (nextRow.depth > item.depth) {
          setHighlightedKey(nextRow.key);
          return true;
        }
      }
      return false;
    }, [rows, highlightedKey, collapsed, toggleCollapse]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "ArrowLeft",
    useCallback(() => {
      if (isInputFocused()) return false;
      const rowIdx = rows.findIndex((r) => r.key === highlightedKey);
      if (rowIdx < 0) return false;
      const item = rows[rowIdx]!;
      if (item.hasChildren && !collapsed.has(item.key)) {
        toggleCollapse(item.key);
        return true;
      }
      if (item.isCategoryHeader) return false;
      for (let i = rowIdx - 1; i >= 0; i--) {
        const candidate = rows[i]!;
        if (candidate.depth < item.depth) {
          setHighlightedKey(candidate.key);
          return true;
        }
      }
      return false;
    }, [rows, highlightedKey, collapsed, toggleCollapse]),
    { priority: 200 },
  );

  const isSelected = (item: TreeItem) => {
    if (!selection || !item.selection) return false;
    return selection.entityId === item.selection.entityId;
  };

  if (isSearching && rows.length === 0) {
    return <NoSearchResults />;
  }

  return (
    <ScrollView className="flex-1 select-none" showsVerticalScrollIndicator={false}>
      <View>
        {rows.map((item, index) => (
          <TreeRow
            key={item.key}
            item={item}
            isSelected={isSelected(item)}
            isHighlighted={index === highlightedIndex}
            isExpanded={isSearching || !collapsed.has(item.key)}
            onToggle={() => {
              setHighlightedKey(item.key);
              toggleCollapse(item.key);
            }}
            onSelect={() => {
              setHighlightedKey(item.key);
              if (item.hasChildren && collapsed.has(item.key)) toggleCollapse(item.key);
              if (item.selection) onSelect(item.selection);
            }}
            ref={index === highlightedIndex ? setHighlightedEl : undefined}
          />
        ))}
      </View>
    </ScrollView>
  );
}

export function ConfigTreeSidebar({
  tree,
  selection,
  onSelect,
  query,
}: {
  tree: CategoryGroup[];
  selection: ConfigSelection;
  onSelect: (sel: ConfigSelection) => void;
  query: string;
}) {
  const t = useThemeColors();

  const isEmpty = tree.length === 0 || tree.every((d) => d.roots.length === 0);

  if (isEmpty) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Radio size={32} strokeWidth={1} color={t.iconMuted} />
        <Text className="text-muted-foreground text-center font-sans text-sm">
          No devices connected
        </Text>
      </View>
    );
  }

  return <TreeView tree={tree} selection={selection} onSelect={onSelect} query={query} />;
}
