import type { LayoutNode } from "@hydris/ui/layout/types";

export const layoutSnapshotRef: {
  current: { activePresetId: string; tree: LayoutNode; isModified: boolean };
} = {
  current: {
    activePresetId: "inspect",
    tree: { type: "pane", id: "pane-1", content: { type: "empty" } },
    isModified: false,
  },
};

export const layoutResetRef: { current: (() => void) | null } = { current: null };
