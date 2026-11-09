import {
  collectRenderedPaths,
  type DragOverride,
  type MapPath,
  reconcileEditDragOverride,
} from "@hydris/map-engine/geometry/rendered-paths";
import type { EntityData, PathPoint } from "@hydris/map-engine/types";
import { destinationDegrees } from "@hydris/map-engine/utils/geodesic-circle";
import { geodesicDistance, initialBearing } from "@hydris/map-engine/utils/geodesy";
import type { Entity } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

import { buildPathLayerData } from "../utils/path-layer-data";
import { selectEditPending, useEditStore } from "./edit-store";
import { useEntityStore } from "./entity-store";

const A = { type: "coordinate", position: { lat: 0, lng: 0 } } as const;
const B = { type: "coordinate", position: { lat: 1, lng: 1 } } as const;
const MOVED = { type: "coordinate", position: { lat: 2, lng: 2 } } as const;

// An edge due east of an equatorial centre is where a hardcoded 90 degrees lands
// anyway. The fraction matters too: a whole degree survives being rounded.
const EDGE_BEARING = 214.37;

beforeEach(() => useEntityStore.getState().reset());

describe("useEditStore", () => {
  beforeEach(() =>
    useEditStore.setState({
      entityId: null,
      points: [],
      rings: undefined,
      radiusM: undefined,
      history: [],
    }),
  );

  // movePoint replaces the array, so asserting the caller's is untouched after a
  // move passes even without a copy. Mutate the caller's array instead.
  it("takes a working copy rather than the caller's array", () => {
    const points: PathPoint[] = [A, B];
    useEditStore.getState().start("range-1", "range", points);
    points[1] = MOVED;

    expect(useEditStore.getState().points).toEqual([A, B]);
  });

  it("steps back one move at a time", () => {
    useEditStore.getState().start("range-1", "range", [A, B]);
    useEditStore.getState().movePoint(0, MOVED);
    useEditStore.getState().movePoint(1, MOVED);
    useEditStore.getState().undo();

    expect(useEditStore.getState().points).toEqual([MOVED, B]);
  });

  it("inserts and undoes a freeform vertex", () => {
    const third = { type: "coordinate", position: { lat: 3, lng: -2 } } as const;
    useEditStore.getState().start("freeform-1", "freeform", [A, B, third]);

    useEditStore.getState().insertPoint(0, MOVED);

    expect(useEditStore.getState().points).toEqual([A, MOVED, B, third]);
    useEditStore.getState().undo();
    expect(useEditStore.getState().points).toEqual([A, B, third]);
  });

  it.each(["range", "circle", "rectangle", "rb-circle"] as const)(
    "rejects insertion for %s",
    (kind) => {
      useEditStore.getState().start("shape-1", kind, [A, B]);
      useEditStore.getState().insertPoint(0, MOVED);

      expect(useEditStore.getState().points).toEqual([A, B]);
      expect(selectEditPending(useEditStore.getState())).toBe(false);
    },
  );

  it.each([-1, 1])("rejects insertion outside a segment at %s", (index) => {
    useEditStore.getState().start("freeform-1", "freeform", [A, B]);
    useEditStore.getState().insertPoint(index, MOVED);

    expect(useEditStore.getState().points).toEqual([A, B]);
    expect(selectEditPending(useEditStore.getState())).toBe(false);
  });

  it("returns the edited points and stops editing on end", () => {
    useEditStore.getState().start("range-1", "range", [A, B]);
    useEditStore.getState().movePoint(0, MOVED);

    expect(useEditStore.getState().end()).toEqual({
      entityId: "range-1",
      kind: "range",
      points: [MOVED, B],
    });
    expect(useEditStore.getState()).toMatchObject({ entityId: null, points: [], history: [] });
  });

  it("saves nothing when ending an edit that changed nothing", () => {
    useEditStore.getState().start("range-1", "range", [A, B]);

    expect(useEditStore.getState().end()).toBeNull();
  });

  it("renders the stored freeform geometry after cancelling a vertex drag", () => {
    const stored = {
      id: "freeform-1",
      pathKind: "freeform",
      pathPoints: [
        { type: "coordinate", position: { lat: 43.4, lng: 39.1 } },
        { type: "coordinate", position: { lat: 42.7, lng: 40.4 } },
        { type: "coordinate", position: { lat: 43.5, lng: 41.0 } },
      ],
    } satisfies EntityData;
    const moved: PathPoint = { type: "coordinate", position: { lat: 42.5, lng: 40.2 } };
    const entities = new Map([[stored.id, stored]]);
    useEditStore.getState().start(stored.id, stored.pathKind, stored.pathPoints);
    useEditStore.getState().movePoint(1, moved);
    const editing = useEditStore.getState();
    const local: MapPath[] = [{ id: stored.id, kind: editing.kind, points: editing.points }];
    let dragOverride: DragOverride | null = {
      pathId: stored.id,
      sourceIndex: 1,
      point: moved,
    };
    dragOverride = reconcileEditDragOverride(local, editing.entityId, dragOverride);
    const [preview] = collectRenderedPaths({
      entities,
      local,
      editingId: editing.entityId,
      dragOverride,
    });
    if (!preview) throw new Error("missing edit preview");
    const previewData = buildPathLayerData(preview, new Map(), new Map());
    expect(previewData.segments[0]?.groundDistanceM).toBeCloseTo(134365.38301741873, 6);
    expect(previewData.segments[1]?.groundDistanceM).toBeCloseTo(128827.36029738876, 6);

    useEditStore.getState().cancel();
    const cancelled = useEditStore.getState();
    dragOverride = reconcileEditDragOverride(
      [],
      cancelled.entityId,
      dragOverride,
      editing.entityId,
    );
    const [rendered] = collectRenderedPaths({
      entities,
      local: [],
      editingId: cancelled.entityId,
      dragOverride,
    });

    expect(rendered?.points, "cancelled edit must render the stored geometry").toEqual(
      stored.pathPoints,
    );
    if (!rendered) throw new Error("missing stored freeform");
    const data = buildPathLayerData(rendered, new Map(), new Map());
    expect(data.segments[0]?.groundDistanceM).toBeCloseTo(131397.20426067853, 6);
    expect(data.segments[1]?.groundDistanceM).toBeCloseTo(101413.00641830111, 6);
  });

  // Pending is the history, not the points. Clearing the points alone leaves the
  // edit reading as unsaved with nothing left to save.
  it("discards the working copy on cancel", () => {
    useEditStore.getState().start("range-1", "range", [A, B]);
    useEditStore.getState().movePoint(0, MOVED);
    expect(selectEditPending(useEditStore.getState())).toBe(true);

    useEditStore.getState().cancel();

    expect(useEditStore.getState()).toMatchObject({ entityId: null, points: [] });
    expect(selectEditPending(useEditStore.getState())).toBe(false);
  });
});

describe("useEditStore, circles", () => {
  const CENTRE = { type: "coordinate", position: { lat: 48, lng: 11 } } as const;
  const EDGE = {
    type: "coordinate",
    position: destinationDegrees(CENTRE.position, EDGE_BEARING, 1000),
  } as const;
  const MOVED_CENTRE = { type: "coordinate", position: { lat: 52, lng: -1 } } as const;

  beforeEach(() =>
    useEditStore.setState({
      entityId: null,
      points: [],
      rings: undefined,
      radiusM: undefined,
      history: [],
    }),
  );

  it("moves an anchored centre using the authoritative radius", () => {
    useEntityStore.setState({
      entities: new Map([
        [
          "track-1",
          {
            id: "track-1",
            geo: { latitude: 0.5, longitude: 0.5 },
          } as Entity,
        ],
      ]),
    });
    useEditStore
      .getState()
      .start(
        "circle-1",
        "circle",
        [{ type: "entity", entityId: "track-1", lastKnownPosition: CENTRE.position }, EDGE],
        undefined,
        1000,
      );
    useEditStore.getState().movePoint(0, MOVED_CENTRE);

    expect(radiusOf(useEditStore.getState().points)).toBeCloseTo(1000, 3);
    expect(bearingOf(useEditStore.getState().points)).toBeCloseTo(EDGE_BEARING, 6);
    expect(useEditStore.getState().radiusM).toBe(1000);
  });

  it("changes a ring set's count without moving its points", () => {
    useEditStore.getState().start("rb-circle-1", "rb-circle", [CENTRE, EDGE], 2);
    useEditStore.getState().setRings(4);

    expect(useEditStore.getState().rings).toBe(4);
    expect(useEditStore.getState().end()).toMatchObject({
      points: [CENTRE, EDGE],
      rings: 4,
    });
  });

  it("restores the previous ring count on undo", () => {
    useEditStore.getState().start("rb-circle-1", "rb-circle", [CENTRE, EDGE], 2);
    useEditStore.getState().setRings(4);
    useEditStore.getState().undo();

    expect(useEditStore.getState().rings).toBe(2);
    expect(selectEditPending(useEditStore.getState())).toBe(false);
  });
});

function bearingOf(points: readonly { type: string; position?: { lat: number; lng: number } }[]) {
  const [a, b] = points;
  if (!a?.position || !b?.position) return 0;
  return initialBearing(
    { latitude: a.position.lat, longitude: a.position.lng },
    { latitude: b.position.lat, longitude: b.position.lng },
  );
}

function radiusOf(points: readonly { type: string; position?: { lat: number; lng: number } }[]) {
  const [a, b] = points;
  if (!a?.position || !b?.position) return 0;
  return geodesicDistance(
    { latitude: a.position.lat, longitude: a.position.lng },
    { latitude: b.position.lat, longitude: b.position.lng },
  );
}

describe("useEditStore, edit order", () => {
  const DRAWN = { lat: 48, lng: 11 };
  const LIVE = { lat: 49.2, lng: 12.4 };
  const ANCHORED = { type: "entity", entityId: "track-1", lastKnownPosition: DRAWN } as const;
  const EDGE = {
    type: "coordinate",
    position: destinationDegrees(DRAWN, EDGE_BEARING, 1000),
  } as const;
  const MOVED_EDGE = {
    type: "coordinate",
    position: destinationDegrees(LIVE, EDGE_BEARING, 2000),
  } as const;

  beforeEach(() => {
    useEntityStore.setState({
      entities: new Map([
        [
          "track-1",
          {
            id: "track-1",
            geo: { latitude: LIVE.lat, longitude: LIVE.lng },
          } as Entity,
        ],
      ]),
    });
    useEditStore.setState({
      entityId: null,
      points: [],
      rings: undefined,
      radiusM: undefined,
      history: [],
    });
  });

  it("keeps the live-anchor radius the edge just set when the centre moves next", () => {
    const edit = useEditStore.getState();
    edit.start("circle-1", "circle", [ANCHORED, EDGE], undefined, 1000);
    edit.movePoint(1, MOVED_EDGE);

    expect(useEditStore.getState().radiusM).toBeCloseTo(2000, 3);

    edit.movePoint(0, { type: "coordinate", position: { lat: 2, lng: 2 } });

    expect(radiusOf(useEditStore.getState().points)).toBeCloseTo(2000, 3);
  });

  it("restores each radius when undos are interleaved with another centre move", () => {
    const edit = useEditStore.getState();
    edit.start("circle-1", "circle", [ANCHORED, EDGE], undefined, 1000);
    edit.movePoint(1, MOVED_EDGE);
    edit.movePoint(0, { type: "coordinate", position: { lat: 2, lng: 2 } });
    edit.undo();

    expect(useEditStore.getState().radiusM).toBeCloseTo(2000, 3);

    edit.movePoint(0, { type: "coordinate", position: { lat: 3, lng: 3 } });
    edit.undo();
    edit.undo();

    expect(useEditStore.getState().radiusM).toBe(1000);
    expect(useEditStore.getState().points).toEqual([ANCHORED, EDGE]);
  });
});
