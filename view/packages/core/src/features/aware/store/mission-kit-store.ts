import { create as createProto } from "@bufbuild/protobuf";
import type { LayoutNode } from "@hydris/ui/layout/types";
import {
  DeviceComponentSchema,
  EntitySchema,
  MissionKitSchema,
  NodeDeviceSchema,
} from "@projectqai/proto/world";
import { create } from "zustand";

import { worldClient } from "../../../lib/api/world-client";

type MissionKitLayout = {
  name: string;
  tree: LayoutNode;
};

type PendingLayout = {
  presetId: string;
  presetName: string;
  tree: LayoutNode;
};

type MissionKitState = {
  layouts: Record<string, MissionKitLayout>;
  nodeId: string | null;
  loading: boolean;
  pendingLayout: PendingLayout | null;
  fetch: () => Promise<void>;
  save: (key: string, name: string, tree: LayoutNode) => Promise<void>;
  remove: (key: string) => Promise<void>;
  setPendingLayout: (presetId: string, presetName: string, tree: LayoutNode) => void;
  clearPendingLayout: () => void;
  reset: () => void;
};

function serializeLayout(name: string, tree: LayoutNode): string {
  return JSON.stringify({ name, tree });
}

function deserializeLayout(raw: string): MissionKitLayout | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.name !== "string" || !parsed.tree)
      return null;
    return { name: parsed.name, tree: parsed.tree };
  } catch {
    return null;
  }
}

async function pushMissionKitLayouts(nodeId: string, layouts: Record<string, string>) {
  const response = await worldClient.push({
    changes: [
      createProto(EntitySchema, {
        id: nodeId,
        device: createProto(DeviceComponentSchema, {
          node: createProto(NodeDeviceSchema, {
            missionKit: createProto(MissionKitSchema, { layouts }),
          }),
        }),
      }),
    ],
  });
  if (!response.accepted) {
    throw new Error(response.debug || "Server rejected mission kit update");
  }
}

export const useMissionKitStore = create<MissionKitState>((set, get) => ({
  layouts: {},
  nodeId: null,
  loading: false,
  pendingLayout: null,

  fetch: async () => {
    set({ loading: true });
    try {
      const res = await worldClient.getLocalNode({});
      const nodeId = res.entity?.id ?? res.nodeId;
      const raw = res.entity?.device?.node?.missionKit?.layouts ?? {};
      const layouts: Record<string, MissionKitLayout> = {};
      for (const [key, value] of Object.entries(raw)) {
        const layout = deserializeLayout(value);
        if (layout) layouts[key] = layout;
      }
      set({ layouts, nodeId, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  save: async (key, name, tree) => {
    const { nodeId, layouts } = get();
    if (!nodeId) return;

    const serialized = serializeLayout(name, tree);
    const rawLayouts: Record<string, string> = {};
    for (const [k, v] of Object.entries(layouts)) {
      rawLayouts[k] = serializeLayout(v.name, v.tree);
    }
    rawLayouts[key] = serialized;

    await pushMissionKitLayouts(nodeId, rawLayouts);
    set({ layouts: { ...layouts, [key]: { name, tree } } });
  },

  setPendingLayout: (presetId, presetName, tree) => {
    set({ pendingLayout: { presetId, presetName, tree } });
  },

  clearPendingLayout: () => {
    set({ pendingLayout: null });
  },

  reset: () => {
    set({ layouts: {}, nodeId: null, loading: false, pendingLayout: null });
  },

  remove: async (key) => {
    const { nodeId, layouts } = get();
    if (!nodeId) return;

    const rawLayouts: Record<string, string> = {};
    for (const [k, v] of Object.entries(layouts)) {
      if (k !== key) rawLayouts[k] = serializeLayout(v.name, v.tree);
    }

    await pushMissionKitLayouts(nodeId, rawLayouts);
    const next = { ...layouts };
    delete next[key];
    set({ layouts: next });
  },
}));
