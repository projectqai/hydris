import { destinationDegrees } from "@hydris/map-engine/utils/geodesic-circle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectPathKind, usePathStore } from "./path-store";

const POINT = { type: "coordinate", position: { lat: 1, lng: 2 } } as const;
const SECOND_POINT = { type: "coordinate", position: { lat: 3, lng: 4 } } as const;
const THIRD_POINT = { type: "coordinate", position: { lat: 5, lng: 6 } } as const;
const MOVED_POINT = { type: "coordinate", position: { lat: 9, lng: 10 } } as const;

beforeEach(() => {
  usePathStore.setState({ paths: [], drawingId: null });
});

describe("path vertex movement", () => {
  it("moves both closing points when the first corner moves", () => {
    usePathStore.setState({
      paths: [{ id: "pinned", kind: "range", points: [POINT, SECOND_POINT, THIRD_POINT, POINT] }],
    });
    usePathStore.getState().movePoint("pinned", 0, MOVED_POINT);

    expect(usePathStore.getState().paths[0]?.points).toEqual([
      MOVED_POINT,
      SECOND_POINT,
      THIRD_POINT,
      MOVED_POINT,
    ]);
  });

  it("moves only a middle vertex in a closed ring", () => {
    usePathStore.setState({
      paths: [{ id: "pinned", kind: "range", points: [POINT, SECOND_POINT, THIRD_POINT, POINT] }],
    });
    usePathStore.getState().movePoint("pinned", 1, MOVED_POINT);

    expect(usePathStore.getState().paths[0]?.points).toEqual([
      POINT,
      MOVED_POINT,
      THIRD_POINT,
      POINT,
    ]);
  });
});

describe("range anchors", () => {
  it("updates entity anchors in pinned ranges and bearings", () => {
    usePathStore.setState({
      paths: [
        {
          id: "pinned",
          kind: "range",
          points: [POINT, { type: "entity", entityId: "track-1" }],
        },
      ],
    });
    usePathStore
      .getState()
      .updateAnchorPositions(new Map([["track-1", { lat: 3, lng: 4, alt: 5 }]]));

    expect(usePathStore.getState().paths[0]?.points).toEqual([
      POINT,
      {
        type: "entity",
        entityId: "track-1",
        lastKnownPosition: { lat: 3, lng: 4, alt: 5 },
      },
    ]);
  });

  it("retains an entity point's last known position while it is unresolved", () => {
    const entityPoint = {
      type: "entity",
      entityId: "track-1",
      lastKnownPosition: { lat: 3, lng: 4 },
    } as const;
    usePathStore.setState({
      paths: [{ id: "pinned", kind: "range", points: [entityPoint] }],
    });
    usePathStore.getState().updateAnchorPositions(new Map());

    expect(usePathStore.getState().paths[0]?.points).toEqual([entityPoint]);
  });

  it("does not refresh drawing anchor snapshots", () => {
    const entityPoint = {
      type: "entity",
      entityId: "track-1",
      lastKnownPosition: { lat: 1, lng: 2 },
    } as const;
    usePathStore.setState({
      paths: [{ id: "circle", kind: "circle", points: [entityPoint, SECOND_POINT] }],
    });
    usePathStore.getState().updateAnchorPositions(new Map([["track-1", { lat: 3, lng: 4 }]]));

    expect(usePathStore.getState().paths[0]?.points).toEqual([entityPoint, SECOND_POINT]);
  });
});

describe("drawing paths", () => {
  it.each(["range", "circle", "rb-circle", "rectangle", "freeform"] as const)(
    "publishes the final %s point and completion together",
    (kind) => {
      const store = usePathStore.getState();
      if (kind === "range") store.toggleActive();
      else store.start(kind);
      store.addPoint(POINT);
      if (kind === "rectangle" || kind === "freeform") store.addPoint(SECOND_POINT);
      if (kind === "freeform") store.addPoint(THIRD_POINT);
      const changed = vi.fn();
      const unsubscribe = usePathStore.subscribe(changed);
      try {
        const finished = store.addPoint(kind === "freeform" ? POINT : THIRD_POINT);
        expect(finished).not.toBeNull();
        expect(changed).toHaveBeenCalledOnce();
        expect(changed.mock.calls[0]?.[0]).toMatchObject({
          drawingId: null,
          paths: [finished],
        });
      } finally {
        unsubscribe();
      }
    },
  );

  it("captures an anchored circle's live radius before awaiting its entity", () => {
    const live = { lat: 1, lng: 1 };
    usePathStore.getState().start("circle");
    usePathStore.getState().addPoint({ type: "entity", entityId: "track-1" });

    const finished = usePathStore
      .getState()
      .addPoint(
        { type: "coordinate", position: destinationDegrees(live, 90, 2000) },
        new Map([["track-1", live]]),
      );

    expect(finished?.radiusM).toBeCloseTo(2000, 6);
    expect(finished?.points[0]).toEqual({
      type: "entity",
      entityId: "track-1",
      lastKnownPosition: live,
    });
  });

  // C shares the first point's longitude and D its latitude, so a closure that
  // only ever looks at one of the two would end the shape early. The closing
  // click is its own object, which is how it arrives from a real gesture.
  it("keeps taking points until a freeform closes on its first one", () => {
    const A = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } } as const;
    const B = { type: "coordinate", position: { lat: 52.4, lng: -1.2 } } as const;
    const C = { type: "coordinate", position: { lat: 52.4, lng: -1.7 } } as const;
    const D = { type: "coordinate", position: { lat: 51.9, lng: -1.2 } } as const;
    const closing = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } } as const;
    usePathStore.getState().start("freeform");

    expect(usePathStore.getState().addPoint(A)).toBeNull();
    expect(usePathStore.getState().addPoint(B)).toBeNull();
    expect(usePathStore.getState().addPoint(C)).toBeNull();
    expect(usePathStore.getState().addPoint(D)).toBeNull();

    const closed = usePathStore.getState().addPoint(closing);
    expect(closed?.points).toEqual([A, B, C, D, closing]);
    expect(selectPathKind(usePathStore.getState())).toBeNull();
  });

  // The two clicks are separate events, so the duplicate is an equal point and
  // not the same object.
  it("drops the duplicate a double-click leaves behind", () => {
    const A = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } } as const;
    const B = { type: "coordinate", position: { lat: 52.4, lng: -1.2 } } as const;
    const secondClick = { type: "coordinate", position: { lat: 52.4, lng: -1.2 } } as const;
    usePathStore.getState().start("freeform");
    usePathStore.getState().addPoint(A);
    usePathStore.getState().addPoint(B);
    usePathStore.getState().addPoint(secondClick);

    expect(usePathStore.getState().finishByGesture()?.points).toEqual([A, B]);
  });

  // A last point that moved on only one axis is still a point someone placed, so
  // each axis has to be enough on its own to say the two clicks differ.
  it.each([
    ["latitude", { type: "coordinate", position: { lat: 52.4, lng: -1.2 } } as const],
    ["longitude", { type: "coordinate", position: { lat: 51.9, lng: -1.4 } } as const],
  ])("keeps every point when the last one moved in %s", (_axis, last) => {
    const A = { type: "coordinate", position: { lat: 51.9, lng: -1.7 } } as const;
    const B = { type: "coordinate", position: { lat: 51.9, lng: -1.2 } } as const;
    usePathStore.getState().start("freeform");
    usePathStore.getState().addPoint(A);
    usePathStore.getState().addPoint(B);
    usePathStore.getState().addPoint(last);

    expect(usePathStore.getState().finishByGesture()?.points).toEqual([A, B, last]);
  });

  it("changes the active ring count", () => {
    usePathStore.getState().start("rb-circle");
    usePathStore.getState().setRings(3);

    expect(usePathStore.getState().paths[0]?.rings).toBe(3);
  });
});
