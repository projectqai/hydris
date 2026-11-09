import { create } from "@bufbuild/protobuf";
import { rectangleCorners } from "@hydris/map-engine/geometry/rectangle";
import type { GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { destinationDegrees } from "@hydris/map-engine/utils/geodesic-circle";
import { geodesicDistance, initialBearing } from "@hydris/map-engine/utils/geodesy";
import { type Entity, EntitySchema } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/use-entity-mutation", () => ({ updateDrawing: vi.fn() }));
vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

import { CONTROLLER_ID } from "../../../lib/api/controller-id";
import { updateDrawing } from "../../../lib/api/use-entity-mutation";
import { writeDrawing, writeMetrics } from "../../../lib/api/write-drawing";
import type { PlacementContextValue } from "../placement-context";
import { useEntityStore } from "./entity-store";
import { moveDrawing, prepareDrawingMove } from "./move-drawing";

const coordinate = (position: GeoPosition): PathPoint => ({ type: "coordinate", position });

function drawnEntity(
  kind: "range" | "freeform" | "rectangle",
  positions: readonly GeoPosition[],
): Entity {
  const points = positions.map(coordinate);
  return create(EntitySchema, {
    id: `drawn-${kind}`,
    controller: { id: CONTROLLER_ID },
    shape: writeDrawing(kind, points),
    metric: writeMetrics(kind, points),
  });
}

function expectPositionClose(actual: GeoPosition, expected: GeoPosition): void {
  expect(actual.lat).toBeCloseTo(expected.lat, 9);
  expect(actual.lng).toBeCloseTo(expected.lng, 9);
}

function average(positions: readonly GeoPosition[]): GeoPosition {
  return {
    lat: positions.reduce((sum, point) => sum + point.lat, 0) / positions.length,
    lng: positions.reduce((sum, point) => sum + point.lng, 0) / positions.length,
  };
}

describe("moveDrawing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntityStore.getState().reset();
  });

  it("preserves sides and bearings when placement confirms a long move", async () => {
    const vertices = [
      { lat: 50.35, lng: 7.38 },
      { lat: 50.365, lng: 7.45 },
      { lat: 50.395, lng: 7.435 },
      { lat: 50.37, lng: 7.375 },
    ];
    const from = average(vertices);
    const to = { lat: 70.23, lng: -31.72 };
    const entity = drawnEntity("freeform", [...vertices, vertices[0]!]);
    const enterPlacement = vi.fn<PlacementContextValue["enterPlacement"]>();

    moveDrawing(entity, enterPlacement);
    const options = enterPlacement.mock.calls[0]![1]!;
    expectPositionClose(options.recenterAt!, from);
    expect(updateDrawing).not.toHaveBeenCalled();
    await options.onConfirm!(to);

    expect(updateDrawing).toHaveBeenCalledOnce();
    const [updatedEntity, kind, points] = vi.mocked(updateDrawing).mock.calls[0]!;
    expect(updatedEntity).toBe(entity);
    expect(kind).toBe("freeform");
    const moved = points.flatMap((point) => (point.type === "coordinate" ? [point.position] : []));
    expect(moved).toHaveLength(5);
    expect(moved[4]).toEqual(moved[0]);
    for (const [index, vertex] of vertices.entries()) {
      const next = vertices[(index + 1) % vertices.length]!;
      const point = moved[index]!;
      const movedNext = moved[index + 1]!;
      expect(
        initialBearing(
          { latitude: to.lat, longitude: to.lng },
          { latitude: point.lat, longitude: point.lng },
        ),
      ).toBeCloseTo(
        initialBearing(
          { latitude: from.lat, longitude: from.lng },
          { latitude: vertex.lat, longitude: vertex.lng },
        ),
        6,
      );
      expect(
        geodesicDistance(
          { latitude: point.lat, longitude: point.lng },
          { latitude: movedNext.lat, longitude: movedNext.lng },
        ),
      ).toBeCloseTo(
        geodesicDistance(
          { latitude: vertex.lat, longitude: vertex.lng },
          { latitude: next.lat, longitude: next.lng },
        ),
        5,
      );
    }
  });

  it("moves live anchor positions as fixed vertices and preserves altitudes", async () => {
    const points: PathPoint[] = [
      { type: "entity", entityId: "track-1", lastKnownPosition: { lat: 51.2, lng: -1.4, alt: 80 } },
      coordinate({ lat: 51.7, lng: -0.6, alt: 35 }),
      coordinate({ lat: 50.9, lng: 0.3 }),
    ];
    const entity = create(EntitySchema, {
      id: "freeform-1",
      controller: { id: CONTROLLER_ID },
      shape: writeDrawing("freeform", points),
    });
    const live = { lat: 52.3, lng: -1.1, alt: 90 };
    useEntityStore.setState({
      entities: new Map([
        [
          "track-1",
          create(EntitySchema, {
            id: "track-1",
            geo: { latitude: live.lat, longitude: live.lng, altitude: live.alt },
          }),
        ],
      ]),
    });
    const enterPlacement = vi.fn<PlacementContextValue["enterPlacement"]>();
    moveDrawing(entity, enterPlacement);
    const options = enterPlacement.mock.calls[0]![1]!;
    const from = average([live, { lat: 51.7, lng: -0.6 }, { lat: 50.9, lng: 0.3 }]);
    expectPositionClose(options.recenterAt!, from);
    const to = { lat: 47, lng: 10 };
    await options.onConfirm!(to);

    const moved = vi.mocked(updateDrawing).mock.calls[0]![2];
    expect(moved.map((point) => point.type)).toEqual(["coordinate", "coordinate", "coordinate"]);
    const positions = moved.flatMap((point) =>
      point.type === "coordinate" ? [point.position] : [],
    );
    expect(positions.map((point) => point.alt)).toEqual([90, 35, undefined]);
    const first = positions[0]!;
    expect(
      geodesicDistance(
        { latitude: to.lat, longitude: to.lng },
        { latitude: first.lat, longitude: first.lng },
      ),
    ).toBeCloseTo(
      geodesicDistance(
        { latitude: from.lat, longitude: from.lng },
        { latitude: live.lat, longitude: live.lng },
      ),
      6,
    );
  });

  it.each<"circle" | "rb-circle">(["circle", "rb-circle"])(
    "places a large high-latitude %s's centre at the confirmed destination",
    async (kind) => {
      const entity = create(EntitySchema, {
        id: `drawn-${kind}`,
        controller: { id: CONTROLLER_ID },
        shape: writeDrawing(
          kind,
          [coordinate({ lat: 74.31, lng: 23.47 }), coordinate({ lat: 75.86, lng: 31.29 })],
          3,
          240_000,
        ),
      });
      const destination = { lat: 61.73, lng: -38.26 };
      const enterPlacement = vi.fn<PlacementContextValue["enterPlacement"]>();

      moveDrawing(entity, enterPlacement);
      const options = enterPlacement.mock.calls[0]?.[1];
      if (!options?.onConfirm) throw new Error("Placement did not provide a confirmation callback");
      await options.onConfirm(destination);

      expect(updateDrawing).toHaveBeenCalledOnce();
      const centre = vi.mocked(updateDrawing).mock.calls[0]?.[2][0];
      if (centre?.type !== "coordinate") throw new Error("Moved centre is not a fixed coordinate");
      expectPositionClose(centre.position, destination);
    },
  );

  it("keeps exact coordinates when placement confirms the original centre", async () => {
    const positions = [
      { lat: 63.68, lng: 18.36 },
      { lat: 63.73, lng: 18.47 },
    ];
    const entity = drawnEntity("range", positions);
    const enterPlacement = vi.fn<PlacementContextValue["enterPlacement"]>();
    moveDrawing(entity, enterPlacement);
    const options = enterPlacement.mock.calls[0]![1]!;
    await options.onConfirm!(options.recenterAt!);

    expect(vi.mocked(updateDrawing).mock.calls[0]![2]).toEqual(positions.map(coordinate));
  });
});

describe("prepareDrawingMove", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prepares a range from its rendered endpoints", () => {
    const positions = [
      { lat: 63.421, lng: -42.713 },
      { lat: 64.093, lng: -39.227 },
    ];

    const prepared = prepareDrawingMove(drawnEntity("range", positions));

    expect(prepared?.path.kind).toBe("range");
    expect(prepared?.path.points).toEqual(positions.map(coordinate));
    expectPositionClose(prepared!.centroid, average(positions));
  });

  it("uses every vertex of an open freeform", () => {
    const positions = [
      { lat: 57.312, lng: 8.417 },
      { lat: 58.061, lng: 11.882 },
      { lat: 56.744, lng: 14.239 },
    ];

    const prepared = prepareDrawingMove(drawnEntity("freeform", positions));

    expect(prepared?.path.kind).toBe("freeform");
    expect(prepared?.path.points).toEqual(positions.map(coordinate));
    expectPositionClose(prepared!.centroid, average(positions));
  });

  it("centres an off-axis rectangle without counting its repeated closing corner", () => {
    const first = { lat: 67.234, lng: -43.87 };
    const second = destinationDegrees(first, 37, 23_000);
    const depth = destinationDegrees(second, 122, 17_000);
    const corners = rectangleCorners(first, second, depth);

    const prepared = prepareDrawingMove(drawnEntity("rectangle", [first, second, depth]));

    expect(prepared?.path.kind).toBe("rectangle");
    expect(prepared?.path.points).toHaveLength(3);
    expectPositionClose(prepared!.centroid, average(corners));
  });
});
