import { create as createProto } from "@bufbuild/protobuf";
import type { LayoutNode } from "@hydris/ui/layout/types";
import type { Entity } from "@projectqai/proto/world";
import { EntitySchema } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/world-client", () => ({
  baseUrl: "http://localhost:50051",
  worldClient: {
    push: vi.fn(),
    getLocalNode: vi.fn(),
    listEntities: vi.fn(),
    watchEntities: vi.fn(),
    getEntity: vi.fn(),
  },
}));

const { useEntityStore } = await import("./entity-store");
const { useMissionKitStore } = await import("./mission-kit-store");
const { worldClient } = await import("../../../lib/api/world-client");

const NODE_ID = "node.test";

function makeMissionKitNode(layouts: Record<string, string>): Entity {
  return {
    id: NODE_ID,
    device: {
      node: {
        mission: { layouts },
      },
    },
  } as Entity;
}

function pushNodeEntity(node: Entity) {
  const entities = new Map<string, Entity>();
  entities.set(node.id, node);
  useEntityStore.setState({ entities });
}

describe("mission-kit store: dedup + reset behavior", () => {
  beforeEach(() => {
    useMissionKitStore.getState().reset();
    useMissionKitStore.setState({ nodeId: NODE_ID });
    useEntityStore.setState({ entities: new Map() });
  });

  it("reset + re-import of the same pack re-applies layouts", () => {
    const layoutJSON = JSON.stringify({
      name: "Inspect",
      tree: { type: "pane", id: "p1", content: { type: "empty" } },
    });

    pushNodeEntity(makeMissionKitNode({ inspect: layoutJSON }));
    expect(useMissionKitStore.getState().layouts.inspect).toBeDefined();

    useMissionKitStore.getState().reset();
    expect(useMissionKitStore.getState().layouts).toEqual({});

    useMissionKitStore.setState({ nodeId: NODE_ID });
    pushNodeEntity(makeMissionKitNode({ inspect: layoutJSON }));

    expect(useMissionKitStore.getState().layouts.inspect).toBeDefined();
  });

  it("identical MissionKit pushed twice fires the store once, regardless of key order", () => {
    const emptyTree = { type: "pane", id: "p", content: { type: "empty" } };
    const layoutA = JSON.stringify({ name: "A", tree: emptyTree });
    const layoutB = JSON.stringify({ name: "B", tree: emptyTree });

    let fireCount = 0;
    const unsub = useMissionKitStore.subscribe(() => {
      fireCount++;
    });
    try {
      pushNodeEntity(makeMissionKitNode({ a: layoutA, b: layoutB }));
      pushNodeEntity(makeMissionKitNode({ b: layoutB, a: layoutA }));
      expect(fireCount).toBe(1);
    } finally {
      unsub();
    }
  });
});

describe("mission-kit store: save preserves sibling device fields", () => {
  beforeEach(() => {
    useMissionKitStore.getState().reset();
    useEntityStore.setState({ entities: new Map() });
    vi.mocked(worldClient.push).mockResolvedValue({ accepted: true } as never);
  });

  it("re-sends node hardware + mission metadata, changing only layouts", async () => {
    const seeded = createProto(EntitySchema, {
      id: NODE_ID,
      device: { node: { hostname: "edge-01", mission: { entityCount: 42, packVersion: "1.2.3" } } },
    });
    pushNodeEntity(seeded);
    useMissionKitStore.setState({ nodeId: NODE_ID });

    const tree = { type: "pane", id: "p1", content: { type: "empty" } } as LayoutNode;
    await useMissionKitStore.getState().save("inspect", "Inspect", tree);

    const pushedNode = vi.mocked(worldClient.push).mock.calls[0]![0].changes?.[0]?.device?.node;
    expect(pushedNode?.hostname).toBe("edge-01");
    expect(pushedNode?.mission?.entityCount).toBe(42);
    expect(pushedNode?.mission?.packVersion).toBe("1.2.3");
    expect(Object.keys(pushedNode?.mission?.layouts ?? {})).toEqual(["inspect"]);
  });
});
