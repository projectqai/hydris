import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/use-entity-mutation", () => ({
  pushPath: vi.fn(),
}));
vi.mock("../../../lib/sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../../lib/api/world-client", () => ({
  worldClient: { watchEntities: vi.fn(), getLocalNode: vi.fn(), getEntity: vi.fn() },
}));

import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import type { EditKind } from "@hydris/map-engine/types";

import { pushPath } from "../../../lib/api/use-entity-mutation";
import { toast } from "../../../lib/sonner";
import { arrivedPathIds, TOOL } from "../utils/map-paths";
import { useEntityStore } from "./entity-store";
import { usePathStore } from "./path-store";
import { savePath } from "./save-path";

const POINT = { type: "coordinate", position: { lat: 1, lng: 2 } } as const;

// These tests cover the local path lifecycle only. Persistence and read-back
// are exercised separately without mocking the serializer.
type Tool = {
  tool: EditKind;
  pointsToFinish: number;
  arm: () => void;
  paths: () => readonly MapPath[];
};

const tool = (kind: EditKind, pointsToFinish: number): Tool => ({
  tool: kind,
  pointsToFinish,
  arm: () => {
    if (kind === "range") void usePathStore.getState().toggleActive();
    else usePathStore.getState().start(kind);
  },
  paths: () => usePathStore.getState().paths,
});

const TOOLS: Tool[] = [
  tool("range", 2),
  tool("circle", 2),
  tool("rb-circle", 2),
  tool("rectangle", 3),
  tool("freeform", 3),
];

async function placeAll(current: Tool) {
  current.arm();
  for (let i = 0; i < current.pointsToFinish; i++) {
    await savePath(usePathStore.getState().addPoint(POINT));
  }
  if (usePathStore.getState().drawingId) await savePath(usePathStore.getState().finish());
}

describe.each(TOOLS)("placing a $tool", (current) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pushPath).mockResolvedValue("entity-1");
    usePathStore.setState({ paths: [], drawingId: null });
    useEntityStore.setState({ entities: new Map() });
  });

  it("discards a path that finishes before it has enough points", async () => {
    current.arm();
    await savePath(usePathStore.getState().addPoint(POINT));

    expect(usePathStore.getState().finish()).toBeNull();
    expect(current.paths()).toHaveLength(0);
    expect(usePathStore.getState().drawingId).toBeNull();
  });

  it("drops its local copy once the entity comes back", async () => {
    await placeAll(current);
    const [path] = current.paths();

    expect(arrivedPathIds(current.paths(), (id) => id === path!.savedAs)).toEqual([path!.id]);
    expect(arrivedPathIds(current.paths(), () => false)).toEqual([]);
  });

  it("discards the local shape and names it when the push fails", async () => {
    vi.mocked(pushPath).mockRejectedValue(new Error("network unavailable"));
    await placeAll(current);

    expect(current.paths()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(
      `Failed to save ${TOOL[current.tool].label}: network unavailable`,
    );
  });
});

describe("an idle path store", () => {
  beforeEach(() => usePathStore.setState({ paths: [], drawingId: null }));

  it("ignores a point when no tool is armed", () => {
    expect(usePathStore.getState().addPoint(POINT)).toBeNull();
    expect(usePathStore.getState().paths).toEqual([]);
  });

  it("removes one finished path by id", () => {
    usePathStore.setState({
      paths: [
        { id: "range", kind: "range", points: [POINT] },
        { id: "circle", kind: "circle", points: [POINT] },
      ],
    });
    usePathStore.getState().remove("range");

    expect(usePathStore.getState().paths).toEqual([
      { id: "circle", kind: "circle", points: [POINT] },
    ]);
  });

  it("clears every finished path while unarmed", () => {
    usePathStore.setState({
      paths: [
        { id: "range", kind: "range", points: [POINT] },
        { id: "circle", kind: "circle", points: [POINT] },
      ],
    });
    usePathStore.getState().clear();

    expect(usePathStore.getState()).toMatchObject({ paths: [], drawingId: null });
  });
});
