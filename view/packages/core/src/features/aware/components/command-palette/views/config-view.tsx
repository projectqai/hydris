"use no memo";

import { useKeyboardShortcut } from "@hydris/ui/keyboard";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInLeft,
  SlideOutLeft,
} from "react-native-reanimated";

import { ConfigPanel } from "../../configuration-modal/config-panel";
import { ConfigTreeSidebar } from "../../configuration-modal/config-tree-sidebar";
import type { ConfigSelection } from "../../configuration-modal/use-config-tree";
import { useConfigTree } from "../../configuration-modal/use-config-tree";

const SIDEBAR_WIDTH = 300;
export const WIDE_BREAKPOINT = 860;

const drawerPanelStyle: ViewStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  bottom: 0,
  width: SIDEBAR_WIDTH,
  borderRightWidth: 1,
};

const scrimEntering = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const scrimExiting = FadeOut.duration(140).reduceMotion(ReduceMotion.System);
const panelEntering = SlideInLeft.duration(220).reduceMotion(ReduceMotion.System);
const panelExiting = SlideOutLeft.duration(180).reduceMotion(ReduceMotion.System);

function TreeDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const t = useThemeColors();
  return (
    <>
      <Animated.View
        entering={scrimEntering}
        exiting={scrimExiting}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: t.backdrop,
        }}
      >
        <Pressable onPress={onClose} accessibilityLabel="Close device list" style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View
        entering={panelEntering}
        exiting={panelExiting}
        style={[drawerPanelStyle, { backgroundColor: t.card, borderRightColor: t.borderSubtle }]}
      >
        {children}
      </Animated.View>
    </>
  );
}

export function ConfigView({
  entityId,
  query,
  treeOpen,
  onTreeOpenChange,
}: {
  entityId?: string;
  query: string;
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= WIDE_BREAKPOINT;

  const tree = useConfigTree();
  const [selection, setSelection] = useState<ConfigSelection>(() =>
    entityId ? { type: "device", entityId } : null,
  );

  useKeyboardShortcut(
    "Escape",
    useCallback(() => {
      if (isWide || !treeOpen) return false;
      onTreeOpenChange(false);
      return true;
    }, [isWide, treeOpen, onTreeOpenChange]),
    { priority: 201 },
  );

  const handleSelect = useCallback(
    (sel: ConfigSelection) => {
      setSelection(sel);
      if (!isWide) onTreeOpenChange(false);
    },
    [isWide, onTreeOpenChange],
  );

  const treeSidebar = (
    <ConfigTreeSidebar tree={tree} selection={selection} onSelect={handleSelect} query={query} />
  );

  if (isWide) {
    return (
      <View className="flex-1 flex-row">
        {treeOpen && (
          <>
            <View style={{ width: SIDEBAR_WIDTH }}>{treeSidebar}</View>
            <View className="bg-surface-overlay/6 w-px" />
          </>
        )}
        <View className="flex-1">
          <ConfigPanel selection={selection} onSelect={handleSelect} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <ConfigPanel selection={selection} onSelect={handleSelect} />
      {treeOpen && <TreeDrawer onClose={() => onTreeOpenChange(false)}>{treeSidebar}</TreeDrawer>}
    </View>
  );
}
