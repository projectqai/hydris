import { create } from "@bufbuild/protobuf";
import type { PathPoint } from "@hydris/map-engine/types";
import { type Entity, EntitySchema, GeoSpatialComponentSchema } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({ getRandomValues: vi.fn() }));
vi.mock("./world-client", () => ({ worldClient: { push: vi.fn() } }));

import { useEditStore } from "../../features/aware/store/edit-store";
import { useEntityStore } from "../../features/aware/store/entity-store";
import { updateDrawing } from "./use-entity-mutation";
import { worldClient } from "./world-client";
import { writeDrawing, writeMetrics } from "./write-drawing";

const first = { type: "coordinate", position: { lat: 48, lng: 11 } } as const;
const second = { type: "coordinate", position: { lat: 48.5, lng: 11.4 } } as const;

function rangeEntity() {
  return create(EntitySchema, {
    id: "range-1",
    label: "R&B",
    shape: writeDrawing("range", [first, second]),
    metric: writeMetrics("range", [first, second]),
  });
}

function ringEntity() {
  return create(EntitySchema, {
    id: "ring-set-1",
    label: "R&B Circle",
    shape: writeDrawing("rb-circle", [first, second], 2, 1_000),
    metric: writeMetrics("rb-circle", [first, second], 2, 1_000),
  });
}

function ringCircles(entity: Entity | undefined) {
  const plane = entity?.shape?.geometry?.planar?.plane;
  if (plane?.case !== "collection") throw new Error("Expected a ring collection");
  return plane.value.geometries.flatMap((geometry) =>
    geometry.plane.case === "circle" ? [geometry.plane.value] : [],
  );
}

describe("updateDrawing metrics", () => {
  beforeEach(() => {
    vi.mocked(worldClient.push).mockReset();
    vi.mocked(worldClient.push).mockResolvedValue({ accepted: true } as never);
  });

  it("removes fixed metrics when a range becomes anchored", async () => {
    const entity = rangeEntity();
    const anchor = create(EntitySchema, {
      id: "track-1",
      geo: create(GeoSpatialComponentSchema, { latitude: 49, longitude: 12 }),
    });
    useEntityStore.setState({
      entities: new Map([
        [entity.id, entity],
        [anchor.id, anchor],
      ]),
    });
    const points: PathPoint[] = [
      { type: "entity", entityId: anchor.id, lastKnownPosition: { lat: 49, lng: 12 } },
      second,
    ];

    await updateDrawing(entity, "range", points);

    const request = vi.mocked(worldClient.push).mock.calls[0]![0];
    expect(request.replacements ?? []).toEqual([]);
    expect(request.changes).toHaveLength(2);
    const [shape, expiry] = request.changes ?? [];
    expect(shape?.shape).toBeDefined();
    expect(shape?.lifetime?.from).toBeDefined();
    expect(shape?.lifetime?.until).toBeUndefined();
    expect(expiry?.metric?.metrics).toEqual([]);
    expect(expiry?.lifetime?.until).toEqual(shape?.lifetime?.from);
    expect(expiry?.shape).toBeUndefined();
    expect(expiry?.label).toBeUndefined();
  });

  it("keeps fixed-coordinate edits on the component update path", async () => {
    const entity = rangeEntity();
    useEntityStore.setState({ entities: new Map([[entity.id, entity]]) });

    await updateDrawing(entity, "range", [first, second]);

    const request = vi.mocked(worldClient.push).mock.calls[0]![0];
    expect(request.changes).toHaveLength(1);
    const [change] = request.changes ?? [];
    expect(change?.metric?.metrics).toHaveLength(2);
    expect(request.replacements ?? []).toEqual([]);
  });
});

describe("updateDrawing ring count", () => {
  beforeEach(() => {
    vi.mocked(worldClient.push).mockReset();
    vi.mocked(worldClient.push).mockResolvedValue({ accepted: true } as never);
    useEditStore.setState({
      entityId: null,
      points: [],
      rings: undefined,
      radiusM: undefined,
      history: [],
    });
  });

  it("stores each ring at a whole base-radius multiple around one centre", async () => {
    const entity = ringEntity();
    useEntityStore.setState({ entities: new Map([[entity.id, entity]]) });
    useEditStore.getState().start(entity.id, "rb-circle", [first, second], 2, 1_000);
    useEditStore.getState().setRings(4);
    const finished = useEditStore.getState().end();
    if (!finished) throw new Error("Expected a finished edit");

    await updateDrawing(entity, finished.kind, finished.points, finished.rings, finished.radiusM);

    const circles = ringCircles(useEntityStore.getState().entities.get(entity.id));
    expect(circles.map((circle) => circle.radiusM)).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(
      circles.map((circle) => ({
        latitude: circle.center?.latitude,
        longitude: circle.center?.longitude,
      })),
    ).toEqual(Array.from({ length: 4 }, () => ({ latitude: 48, longitude: 11 })));
  });

  it("restores the saved ring set when the update is rejected", async () => {
    const entity = ringEntity();
    useEntityStore.setState({ entities: new Map([[entity.id, entity]]) });
    useEditStore.getState().start(entity.id, "rb-circle", [first, second], 2, 1_000);
    useEditStore.getState().setRings(4);
    const finished = useEditStore.getState().end();
    if (!finished) throw new Error("Expected a finished edit");
    vi.mocked(worldClient.push).mockResolvedValue({ accepted: false, debug: "rejected" } as never);

    const update = updateDrawing(
      entity,
      finished.kind,
      finished.points,
      finished.rings,
      finished.radiusM,
    );
    expect(ringCircles(useEntityStore.getState().entities.get(entity.id))).toHaveLength(4);

    await expect(update).rejects.toThrow("rejected");
    expect(
      ringCircles(useEntityStore.getState().entities.get(entity.id)).map(
        (circle) => circle.radiusM,
      ),
    ).toEqual([1_000, 2_000]);
  });
});
