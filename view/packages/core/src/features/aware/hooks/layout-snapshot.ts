import type { LayoutNode } from "@hydris/ui/layout/types";

export const layoutSnapshotRef: {
  current: {
    activePresetId: string;
    tree: LayoutNode;
    isModified: boolean;
    customTrees: Record<string, LayoutNode>;
  };
} = {
  current: {
    activePresetId: "inspect",
    tree: { type: "pane", id: "pane-1", content: { type: "empty" } },
    isModified: false,
    customTrees: {},
  },
};

export const layoutResetRef: { current: (() => void) | null } = { current: null };

// Lets the import flow force a layout re-apply. Same-pack re-import doesn't
// change the engine's MissionKit, so the entity-tick dedup skips the apply
// path otherwise.
export const layoutApplyMissionKitRef: { current: (() => void) | null } = { current: null };
