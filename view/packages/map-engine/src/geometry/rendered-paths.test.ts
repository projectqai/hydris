import { describe, expect, it, vi } from "vitest";

import type { EntityData, PathPoint } from "../types";
import { destinationDegrees } from "../utils/geodesic-circle";
import { geodesicDistance } from "../utils/geodesy";
import type { DragOverride, MapPath } from "./rendered-paths";
import {
  capturePathRadius,
  collectRenderedPaths,
  hasDragLanded,
  reconcileEditDragOverride,
  vertexMatches,
} from "./rendered-paths";

const A: PathPoint = { type: "coordinate", position: { lat: 0, lng: 0 } };
const B: PathPoint = { type: "coordinate", position: { lat: 1, lng: 1 } };
const MOVED = { type: "coordinate", position: { lat: 2, lng: 2 } } as const;

const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  geodesicDistance({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });

function entities(
  ...list: {
    id: string;
    pathPoints?: PathPoint[];
    pathKind?: EntityData["pathKind"];
    pathRadiusM?: number;
  }[]
) {
  return new Map(list.map((e) => [e.id, e as EntityData]));
}

describe("collectRenderedPaths", () => {
  it("takes only the entities that carry vertices", () => {
    const paths = collectRenderedPaths({
      entities: entities(
        { id: "rb-1", pathPoints: [A, B] },
        { id: "a-track-with-no-path" },
        { id: "rb-2", pathPoints: [A, B] },
      ),
      local: [],
      editingId: null,
      dragOverride: null,
    });

    expect(paths.map((path) => path.id)).toEqual(["rb-1", "rb-2"]);
  });

  // A second stored path has to survive the edit. With only the edited one in
  // the map, dropping every stored path while an edit is open looks the same.
  it("drops the stored copy of whatever is being edited, so it cannot double up", () => {
    const paths = collectRenderedPaths({
      entities: entities({ id: "rb-1", pathPoints: [A, B] }, { id: "rb-2", pathPoints: [A, B] }),
      local: [{ id: "rb-1", kind: "range", points: [A, MOVED] }],
      editingId: "rb-1",
      dragOverride: null,
    });

    expect(paths).toEqual([
      { id: "rb-2", kind: "range", points: [A, B] },
      { id: "rb-1", kind: "range", points: [A, MOVED] },
    ]);
  });

  it("still draws a pushed path whose entity has arrived, so the two overlap rather than gap", () => {
    const paths = collectRenderedPaths({
      entities: entities({ id: "rb-1", pathPoints: [A, B] }),
      local: [{ id: "local-1", kind: "range", points: [A, B], savedAs: "rb-1" }],
      editingId: null,
      dragOverride: null,
    });

    expect(paths.map((path) => path.id)).toEqual(["rb-1", "local-1"]);
  });

  it("keeps a local path that was never pushed", () => {
    const paths = collectRenderedPaths({
      entities: entities({ id: "rb-1", pathPoints: [A, B] }),
      local: [{ id: "drawing", kind: "range", points: [A] }],
      editingId: null,
      dragOverride: null,
    });

    expect(paths.map((path) => path.id)).toEqual(["rb-1", "drawing"]);
  });

  it("applies a drag override to its own path only", () => {
    const paths = collectRenderedPaths({
      entities: entities({ id: "rb-1", pathPoints: [A, B] }, { id: "rb-2", pathPoints: [A, B] }),
      local: [],
      editingId: null,
      dragOverride: { pathId: "rb-1", sourceIndex: 1, point: MOVED },
    });

    expect(paths[0]?.points).toEqual([A, MOVED]);
    expect(paths[1]?.points).toEqual([A, B]);
  });
});

describe("reconcileEditDragOverride", () => {
  const centre = { lat: 51.2, lng: -2.4 };
  const undoneEdge = destinationDegrees(centre, 37, 730);
  const draggedEdge = destinationDegrees(centre, 37, 2180);
  const undonePath: MapPath = {
    id: "circle-1",
    kind: "circle",
    points: [
      { type: "coordinate", position: centre },
      { type: "coordinate", position: undoneEdge },
    ],
    radiusM: 730,
  };
  const override: DragOverride = {
    pathId: "circle-1",
    sourceIndex: 1,
    point: { type: "coordinate", position: draggedEdge },
  };

  it("renders the undone working copy instead of a stale circle drag", () => {
    const dragOverride = reconcileEditDragOverride([undonePath], "circle-1", override);
    const [rendered] = collectRenderedPaths({
      entities: new Map(),
      local: [undonePath],
      editingId: "circle-1",
      dragOverride,
    });

    expect(rendered?.radiusM).toBeCloseTo(730, 3);
  });

  it("keeps the override outside an edit while saved or placing geometry catches up", () => {
    expect(reconcileEditDragOverride([], null, override)).toBe(override);
    expect(reconcileEditDragOverride([undonePath], null, override)).toBe(override);
  });
});

describe("hasDragLanded", () => {
  const SENT: PathPoint = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } };

  // A stored position that differs on both axes lands green even if only one is
  // compared, so each axis has to be the only one that moved.
  it.each<[string, PathPoint]>([
    ["latitude", { type: "coordinate", position: { lat: 51.3, lng: -1.7 } }],
    ["longitude", { type: "coordinate", position: { lat: 51.9, lng: -1.2 } }],
  ])("is false while the entity's %s still differs from what was sent", (_axis, stored) => {
    expect(
      hasDragLanded(entities({ id: "rb-1", pathPoints: [A, stored] }), {
        pathId: "rb-1",
        sourceIndex: 1,
        point: SENT,
      }),
    ).toBe(false);
  });

  // The vertex comes back off the wire as its own object, so agreement is by
  // coordinate. Storing the object that was sent would never test that.
  it("is true once the entity agrees with what was sent", () => {
    const landed: PathPoint = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } };

    expect(
      hasDragLanded(entities({ id: "rb-1", pathPoints: [A, landed] }), {
        pathId: "rb-1",
        sourceIndex: 1,
        point: SENT,
      }),
    ).toBe(true);
  });
});

describe("vertexMatches", () => {
  it("compares anchored vertices by entity, not by position", () => {
    expect(
      vertexMatches({ type: "entity", entityId: "t-1" }, { type: "entity", entityId: "t-1" }),
    ).toBe(true);
    expect(
      vertexMatches({ type: "entity", entityId: "t-1" }, { type: "entity", entityId: "t-2" }),
    ).toBe(false);
  });

  it("never matches an anchored vertex against a free one", () => {
    expect(vertexMatches({ type: "entity", entityId: "t-1" }, A)).toBe(false);
    expect(vertexMatches(A, { type: "entity", entityId: "t-1" })).toBe(false);
  });
});

describe("collectRenderedPaths, centre-and-radius shapes", () => {
  const DRAWN = { lat: 67.3, lng: -24.7 };
  const LIVE = { lat: 68.1, lng: -21.4 };
  const EDGE = destinationDegrees(DRAWN, 217.3, 1000);
  const circle: MapPath = {
    id: "circle-1",
    kind: "circle",
    points: [
      { type: "entity", entityId: "track-1", lastKnownPosition: DRAWN },
      { type: "coordinate", position: EDGE },
    ],
    radiusM: 1000,
  };

  // Handing the radius in as a fixture and asserting it back proves nothing: the
  // failure this guards is the radius never reaching the path from its entity.
  it("carries a stored shape's radius onto its rendered path", () => {
    const [path] = collectRenderedPaths({
      entities: new Map([
        [
          "circle-1",
          {
            id: "circle-1",
            pathKind: "circle",
            pathPoints: circle.points,
            pathRadiusM: 1000,
          } as EntityData,
        ],
      ]),
      local: [],
      editingId: null,
      dragOverride: null,
    });

    expect(path?.radiusM).toBe(1000);
  });

  // the handle was dragged against where the anchor is now, so the anchor has to
  // be resolvable or the new radius is measured from where the shape was drawn
  it("takes the radius the edge handle just set without indexing every entity position", () => {
    const world = new Map<string, EntityData>([
      ["track-1", { id: "track-1", position: LIVE }],
      ["other", { id: "other", position: { lat: 63.2, lng: 7.8 } }],
    ]);
    const iterations = vi.spyOn(world, "values");
    const [path] = collectRenderedPaths({
      entities: world,
      local: [circle],
      editingId: "circle-1",
      dragOverride: {
        pathId: "circle-1",
        sourceIndex: 1,
        point: { type: "coordinate", position: destinationDegrees(LIVE, 217.3, 2000) },
      },
    });

    expect(path?.radiusM).toBeCloseTo(2000, 3);
    expect(iterations).toHaveBeenCalledOnce();
  });

  // Reading back the radius the fixture supplied says nothing: the drag could be
  // ignored entirely and the field would still be 1000. Check the shape moved.
  it("carries the authoritative radius when the centre handle is moved", () => {
    const [path] = collectRenderedPaths({
      entities: new Map(),
      local: [circle],
      editingId: "circle-1",
      dragOverride: {
        pathId: "circle-1",
        sourceIndex: 0,
        point: { type: "coordinate", position: LIVE },
      },
    });
    const [centre, edge] = path!.points;

    expect(path?.radiusM).toBe(1000);
    expect(centre).toEqual({ type: "coordinate", position: LIVE });
    expect(edge?.type === "coordinate" && distanceM(LIVE, edge.position)).toBeCloseTo(1000, 3);
  });

  it("captures the live centre and radius when placement finishes", () => {
    const captured = capturePathRadius(
      {
        id: "circle-1",
        kind: "circle",
        points: [
          { type: "entity", entityId: "track-1" },
          { type: "coordinate", position: destinationDegrees(LIVE, 90, 2000) },
        ],
      },
      new Map([["track-1", LIVE]]),
    );

    expect(captured.radiusM).toBeCloseTo(2000, 6);
    expect(captured.points[0]).toEqual({
      type: "entity",
      entityId: "track-1",
      lastKnownPosition: LIVE,
    });
  });
});
