import { clone, create as createProto } from "@bufbuild/protobuf";
import type { LayoutNode } from "@hydris/ui/layout/types";
import type { Entity } from "@projectqai/proto/world";
import {
  DeviceComponentSchema,
  EntitySchema,
  MissionPackSchema,
  NodeDeviceSchema,
} from "@projectqai/proto/world";
import { create } from "zustand";

import { worldClient } from "../../../lib/api/world-client";
import { useEntityStore } from "./entity-store";

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
  saveMany: (updates: Record<string, { name: string; tree: LayoutNode }>) => Promise<void>;
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

// Dedup state for the entity-store subscriber below. Module-scoped so reset()
// can clear it; otherwise a post-reset MissionKit that happens to serialize
// identically to the pre-reset one would be deduped silently.
let lastSerializedLayouts: string | null = null;

function resetDedup() {
  lastSerializedLayouts = null;
}

async function pushMissionKitLayouts(nodeId: string, layouts: Record<string, string>) {
  const node = useEntityStore.getState().entities.get(nodeId);
  const entity = node ? clone(EntitySchema, node) : createProto(EntitySchema, { id: nodeId });
  entity.device ??= createProto(DeviceComponentSchema, {});
  entity.device.node ??= createProto(NodeDeviceSchema, {});
  entity.device.node.mission ??= createProto(MissionPackSchema, {});
  entity.device.node.mission.layouts = layouts;

  const response = await worldClient.push({ changes: [entity] });
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
      const raw = res.entity?.device?.node?.mission?.layouts ?? {};
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
    await get().saveMany({ [key]: { name, tree } });
  },

  saveMany: async (updates) => {
    const { nodeId, layouts } = get();
    if (!nodeId) return;
    if (Object.keys(updates).length === 0) return;

    const rawLayouts: Record<string, string> = {};
    for (const [k, v] of Object.entries(layouts)) {
      rawLayouts[k] = serializeLayout(v.name, v.tree);
    }
    for (const [k, v] of Object.entries(updates)) {
      rawLayouts[k] = serializeLayout(v.name, v.tree);
    }

    await pushMissionKitLayouts(nodeId, rawLayouts);

    const nextLayouts = { ...layouts };
    for (const [k, v] of Object.entries(updates)) {
      nextLayouts[k] = { name: v.name, tree: v.tree };
    }
    set({ layouts: nextLayouts });
  },

  setPendingLayout: (presetId, presetName, tree) => {
    set({ pendingLayout: { presetId, presetName, tree } });
  },

  clearPendingLayout: () => {
    set({ pendingLayout: null });
  },

  reset: () => {
    resetDedup();
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

function deriveLayouts(node: Entity | undefined): Record<string, MissionKitLayout> {
  const raw = node?.device?.node?.mission?.layouts ?? {};
  const out: Record<string, MissionKitLayout> = {};
  for (const [key, value] of Object.entries(raw)) {
    const layout = deserializeLayout(value);
    if (layout) out[key] = layout;
  }
  return out;
}

// Stable serialization of the proto map: key insertion order isn't guaranteed
// to round-trip, so sort keys before stringifying for the dedup comparison.
function stableSerializeLayouts(raw: Record<string, string>): string {
  const keys = Object.keys(raw).sort();
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = raw[k] ?? "";
  return JSON.stringify(out);
}

// Reflect node-entity updates from entity-store into this store. Dedup by
// serialized layouts so consumers don't have to re-implement change
// detection, and so echoes of our own save() are dropped.
useEntityStore.subscribe((state) => {
  const nodeId = useMissionKitStore.getState().nodeId;
  if (!nodeId) return;
  const node = state.entities.get(nodeId);
  if (!node) return;
  const raw = node.device?.node?.mission?.layouts ?? {};
  const serialized = stableSerializeLayouts(raw);
  if (serialized === lastSerializedLayouts) return;
  lastSerializedLayouts = serialized;
  useMissionKitStore.setState({ layouts: deriveLayouts(node) });
});
