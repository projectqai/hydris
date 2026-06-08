import type { LayoutNode } from "@hydris/ui/layout/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
}));

vi.mock("react-native-blob-util", () => ({
  default: {
    fetch: vi.fn(),
    config: vi.fn(),
    wrap: vi.fn(),
    fs: { dirs: { CacheDir: "/tmp" }, unlink: vi.fn() },
    MediaCollection: { copyToMediaStore: vi.fn() },
  },
}));

vi.mock("../../lib/download", () => ({
  downloadFromEndpoint: vi.fn(),
}));

vi.mock("../../lib/sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("../aware/layouts", () => ({
  PRESETS: [
    { id: "inspect", name: "Inspect", root: { type: "pane", id: "p", content: { type: "empty" } } },
    { id: "watch", name: "Watch", root: { type: "pane", id: "p", content: { type: "empty" } } },
  ],
}));

vi.mock("../../lib/api/world-client", () => ({
  baseUrl: "http://localhost:50051",
  worldClient: {
    push: vi.fn().mockResolvedValue({ accepted: true }),
    getLocalNode: vi.fn().mockResolvedValue({ entity: { id: "node.test" }, nodeId: "node.test" }),
    listEntities: vi.fn(),
    watchEntities: vi.fn(),
    getEntity: vi.fn(),
  },
}));

const { worldClient } = await import("../../lib/api/world-client");
const { layoutSnapshotRef } = await import("../aware/hooks/layout-snapshot");
const { useMissionKitStore } = await import("../aware/store/mission-kit-store");
const { captureCurrentLayout } = await import("./use-mission-pack");

const NODE_ID = "node.test";

const emptyPane: LayoutNode = { type: "pane", id: "p1", content: { type: "empty" } };

describe("captureCurrentLayout", () => {
  beforeEach(() => {
    vi.mocked(worldClient.push).mockClear();
    useMissionKitStore.getState().reset();
    useMissionKitStore.setState({ nodeId: NODE_ID });
    layoutSnapshotRef.current = {
      activePresetId: "inspect",
      tree: emptyPane,
      isModified: false,
      customTrees: {},
    };
  });

  it("includes every customized preset, not just the active one", async () => {
    layoutSnapshotRef.current = {
      activePresetId: "inspect",
      tree: emptyPane,
      isModified: true,
      customTrees: {
        inspect: emptyPane,
        watch: emptyPane,
      },
    };

    await captureCurrentLayout();

    expect(worldClient.push).toHaveBeenCalledOnce();
    const pushArg = vi.mocked(worldClient.push).mock.calls[0]![0];
    const pushedLayouts = pushArg.changes?.[0]?.device?.node?.mission?.layouts ?? {};
    expect(Object.keys(pushedLayouts).sort()).toEqual(["inspect", "watch"]);
  });
});
