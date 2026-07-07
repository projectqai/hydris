"use no memo";

import { type ReactNode, useCallback } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInLeft,
  SlideOutLeft,
} from "react-native-reanimated";

import { useKeyboardShortcut } from "../keyboard";
import { useThemeColors } from "../lib/theme";

const SIDEBAR_WIDTH = 300;
const MIN_DETAIL_WIDTH = 360;

export function canDockListDetail(availableWidth: number): boolean {
  return availableWidth >= SIDEBAR_WIDTH + MIN_DETAIL_WIDTH;
}

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

function ListDetailDrawer({
  children,
  onClose,
  closeLabel = "Close list",
}: {
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}) {
  const t = useThemeColors();
  useKeyboardShortcut(
    "Escape",
    useCallback(() => {
      onClose();
      return true;
    }, [onClose]),
    { priority: 201 },
  );
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
        <Pressable onPress={onClose} accessibilityLabel={closeLabel} style={{ flex: 1 }} />
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

export function ListDetailShell({
  isWide,
  treeOpen,
  onTreeClose,
  closeLabel,
  sidebar,
  children,
}: {
  isWide: boolean;
  treeOpen: boolean;
  onTreeClose: () => void;
  closeLabel: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  if (isWide) {
    return (
      <View className="flex-1 flex-row">
        {treeOpen && (
          <>
            <View style={{ width: SIDEBAR_WIDTH }}>{sidebar}</View>
            <View className="bg-surface-overlay/6 w-px" />
          </>
        )}
        <View className="flex-1">{children}</View>
      </View>
    );
  }
  return (
    <View className="flex-1">
      {children}
      {treeOpen && (
        <ListDetailDrawer onClose={onTreeClose} closeLabel={closeLabel}>
          {sidebar}
        </ListDetailDrawer>
      )}
    </View>
  );
}
