"use no memo";

import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useCallback, useState } from "react";
import { useWindowDimensions, View } from "react-native";

import { ConfigPanel } from "../../configuration-modal/config-panel";
import { ConfigTreeSidebar } from "../../configuration-modal/config-tree-sidebar";
import type { ConfigSelection } from "../../configuration-modal/use-config-tree";
import { useConfigTree } from "../../configuration-modal/use-config-tree";

const SIDEBAR_WIDTH = 300;
const WIDE_BREAKPOINT = 768;

export function ConfigView({ entityId, query }: { entityId?: string; query: string }) {
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= WIDE_BREAKPOINT;

  const tree = useConfigTree();
  const [selection, setSelection] = useState<ConfigSelection>(() => {
    if (entityId) return { type: "device", entityId };
    return null;
  });
  const [showConfig, setShowConfig] = useState(!!entityId);

  useKeyboardShortcut(
    "Escape",
    useCallback(() => {
      if (!isWide && showConfig) {
        setShowConfig(false);
        return true;
      }
      return false;
    }, [isWide, showConfig]),
    { priority: 201 },
  );

  const handleSelect = useCallback((sel: ConfigSelection) => {
    setSelection(sel);
    setShowConfig(true);
  }, []);

  return (
    <View className="flex-1">
      {isWide ? (
        <View className="flex-1 flex-row">
          <View style={{ width: SIDEBAR_WIDTH }}>
            <ConfigTreeSidebar
              tree={tree}
              selection={selection}
              onSelect={handleSelect}
              isWide
              query={query}
            />
          </View>
          <View className="bg-surface-overlay/6 w-px" />
          <View className="flex-1">
            <ConfigPanel selection={selection} onSelect={handleSelect} />
          </View>
        </View>
      ) : showConfig ? (
        <ConfigPanel selection={selection} onSelect={handleSelect} />
      ) : (
        <ConfigTreeSidebar
          tree={tree}
          selection={selection}
          onSelect={handleSelect}
          isWide={false}
          query={query}
        />
      )}
    </View>
  );
}
