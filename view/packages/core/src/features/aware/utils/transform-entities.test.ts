import { create } from "@bufbuild/protobuf";
import type { EditKind, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { initialBearing } from "@hydris/map-engine/utils/geodesy";
import { type Entity, EntitySchema } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it, vi } from "vitest";

// writeDrawing resolves a live anchor through the entity store, which opens
// the world client on import.
vi.mock("../../../lib/api/world-client", () => ({ worldClient: {} }));

const toGeoPoint = (position: GeoPosition) => ({
  latitude: position.lat,
  longitude: position.lng,
});

import { shapeToFeatures } from "../../../../../map-engine/src/utils/shape-to-geojson";
import { CONTROLLER_ID } from "../../../lib/api/controller-id";
import { writeDrawing, writeMetrics } from "../../../lib/api/write-drawing";
import type { ChangeSet } from "./transform-entities";
import {
  accumulateChanges,
  buildDelta,
  buildDeltaChunked,
  readDrawing,
  readPathPoints,
  resetDeltaState,
  shapeCentroid,
  transformEntity,
} from "./transform-entities";

function createEntity(id: string, lat = 0, lng = 0): Entity {
  return {
    id,
    geo: { latitude: lat, longitude: lng, altitude: 0 },
    symbol: { milStd2525C: "SFGPU------" },
  } as Entity;
}

function createChangeSet(version: number, updatedIds: string[]): ChangeSet {
  return {
    version,
    updatedIds: new Set(updatedIds),
    deletedIds: new Set(),
    geoChanged: true,
  };
}

describe("transformEntity", () => {
  it("renders a generic circle across the antimeridian as local fill and outline pieces", () => {
    const entity = transformEntity(
      create(EntitySchema, {
        id: "seam-circle",
        shape: {
          geometry: {
            planar: {
              plane: {
                case: "circle",
                value: { center: { latitude: 73.2, longitude: 179.1 }, radiusM: 185_000 },
              },
            },
          },
        },
      }),
    );
    expect(entity?.isDrawn).toBeUndefined();
    expect(entity?.pathPoints).toBeUndefined();
    expect(entity?.shape).toBeDefined();
    if (!entity?.shape) return;
    const features = shapeToFeatures(
      entity.id,
      entity.shape,
      entity.affiliation ?? "unknown",
      entity.isDrawn,
    );
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      const paths =
        feature.geometry.type === "Polygon"
          ? feature.geometry.coordinates
          : feature.geometry.type === "LineString"
            ? [feature.geometry.coordinates]
            : [];
      for (const path of paths) {
        for (const [index, point] of path.entries()) {
          const [lng = Number.NaN, lat = Number.NaN] = point;
          const previous = path[index - 1];
          if (previous) {
            expect(
              Math.abs(lng - (previous[0] ?? Number.NaN)),
              "generic circle edges stay on their side of the antimeridian",
            ).toBeLessThan(180);
          }
          expect(Math.abs(lng)).toBeGreaterThan(173);
          expect(lat).toBeGreaterThanOrEqual(71.54215177211239 - 1e-9);
          expect(lat).toBeLessThanOrEqual(74.85758013653857 + 1e-9);
        }
      }
    }
    const outlines = features.filter((feature) => feature.geometry.type === "LineString");
    const fills = features.filter((feature) => feature.geometry.type === "Polygon");
    for (const pieces of [outlines, fills]) {
      const sides = new Set(
        pieces.flatMap((feature) => {
          const point =
            feature.geometry.type === "Polygon"
              ? feature.geometry.coordinates[0]?.[0]
              : feature.geometry.type === "LineString"
                ? feature.geometry.coordinates[0]
                : undefined;
          return point ? [Math.sign(point[0] ?? Number.NaN)] : [];
        }),
      );
      expect(sides, "fill and outline both occupy the two seam-adjacent world copies").toEqual(
        new Set([-1, 1]),
      );
    }
    expect(fills.every((feature) => feature.properties.fillOnly)).toBe(true);
    const rim = outlines.flatMap((feature) =>
      feature.geometry.type === "LineString" ? feature.geometry.coordinates : [],
    );
    for (const { lng, lat } of [
      { lng: -177.4429858630896, lat: 74.5515792225874 },
      { lng: 176.15212090698034, lat: 71.79893603341874 },
    ]) {
      expect(rim).toContainEqual([expect.closeTo(lng, 9), expect.closeTo(lat, 9)]);
    }
  });

  // Level flight is a rate of zero, which is falsey. A non-zero fixture alone
  // cannot tell "absent" from "reported as zero".
  it.each([-4, 0])("carries a vertical velocity of %i into map entity data", (up) => {
    const entity = {
      ...createEntity("moving"),
      kinematics: { velocityEnu: { east: 2, north: 3, up } },
    } as Entity;

    expect(transformEntity(entity)?.velocityEnu).toEqual({ up });
  });

  it("reports no vertical velocity when the entity has no kinematics", () => {
    expect(transformEntity(createEntity("still"))?.velocityEnu).toBeUndefined();
  });
});

describe("readPathPoints", () => {
  type PlanarPointLiteral = {
    latitude: number;
    longitude: number;
    altitude?: number;
    entity?: string;
  };

  function createShapeEntity(
    plane: { case: string; value: unknown },
    controllerId: string | null = CONTROLLER_ID,
  ): Entity {
    return {
      id: "range",
      controller: controllerId === null ? undefined : { id: controllerId },
      shape: { geometry: { planar: { plane } } },
    } as Entity;
  }

  function createRange(points: PlanarPointLiteral[], controllerId?: string | null): Entity {
    return createShapeEntity({ case: "line", value: { points } }, controllerId);
  }

  it("reads a line of more than two points as a freeform, not a range", () => {
    const drawn = createRange([
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      { latitude: 1, longitude: 1 },
    ]);

    expect(readDrawing(drawn)?.kind).toBe("freeform");
    // a freeform line still carries readouts, so it renders through the path layer
    expect(readPathPoints(drawn)).toHaveLength(3);
  });

  it("reads a two point line as a range and bearing", () => {
    const range = createRange([
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    ]);

    expect(readDrawing(range)?.kind).toBe("range");
  });

  it("ignores a line another producer drew", () => {
    const orbit = createRange(
      [
        { latitude: 1, longitude: 2 },
        { latitude: 4, longitude: 5 },
      ],
      "spacetrack",
    );

    expect(readPathPoints(orbit)).toBeUndefined();
  });

  it.each([
    [
      "radius",
      {
        case: "circle",
        value: { center: { latitude: 48, longitude: 11 }, radiusM: -5000 },
      },
    ],
  ])("does not render a drawn shape with an invalid %s", (_field, plane) => {
    expect(transformEntity(createShapeEntity(plane))).toBeNull();
  });

  it.each([
    ["north bound", { latitude: 91 }],
    ["south bound", { latitude: -91 }],
    ["east bound", { longitude: 181 }],
    ["west bound", { longitude: -181 }],
    ["non-finite latitude", { latitude: Number.NaN }],
    ["non-finite longitude", { longitude: Number.NaN }],
    ["non-finite altitude", { altitude: Number.NaN }],
    ["infinite altitude", { altitude: Number.POSITIVE_INFINITY }],
  ])("rejects a point or anchor snapshot outside the %s", (_name, invalid) => {
    for (const entity of [undefined, "target-1"]) {
      const range = createRange([
        { latitude: 51.3, longitude: -2.7 },
        { latitude: 48.9, longitude: 1.4, entity, ...invalid },
      ]);
      expect(transformEntity(range)).toBeNull();
    }
  });

  it("rejects a blank anchor id", () => {
    expect(
      transformEntity(
        createRange([
          { latitude: 51.3, longitude: -2.7 },
          { latitude: 48.9, longitude: 1.4, entity: " " },
        ]),
      ),
    ).toBeNull();
  });

  it("keeps coordinate bounds and zero altitude", () => {
    const range = createRange([
      { latitude: -90, longitude: 180, altitude: 0 },
      { latitude: 90, longitude: -180 },
    ]);
    expect(transformEntity(range)?.pathPoints).toEqual([
      { type: "coordinate", position: { lat: -90, lng: 180, alt: 0 } },
      { type: "coordinate", position: { lat: 90, lng: -180 } },
    ]);
  });

  it("ignores a line too short to measure", () => {
    expect(readPathPoints(createRange([{ latitude: 1, longitude: 2 }]))).toBeUndefined();
  });

  it.each([
    {
      kind: "circle",
      plane: { case: "circle", value: { center: { latitude: 70, longitude: 13 }, radiusM: 4300 } },
    },
    {
      kind: "rectangle",
      plane: {
        case: "polygon",
        value: {
          outer: {
            points: [
              { latitude: 70, longitude: 13 },
              { latitude: 70.70860943684576, longitude: 14.631661090228496 },
              { latitude: 70.50033901604002, longitude: 15.408231162899193 },
              { latitude: 69.79873921666885, longitude: 13.766452527663175 },
              { latitude: 70, longitude: 13 },
            ],
          },
          holes: [],
        },
      },
    },
  ])("retains the published $kind primitive for zoom-dependent outlines", ({ kind, plane }) => {
    const entity = transformEntity(createShapeEntity(plane));
    expect(entity?.pathKind, "published outlines must retain their logical drawing primitive").toBe(
      kind,
    );
    expect(entity?.pathPoints?.[0]).toEqual({ type: "coordinate", position: { lat: 70, lng: 13 } });
    expect(entity?.shape, "shape visibility and centroid data remain available").toBeDefined();
    expect(entity?.position).toBeDefined();
  });

  it("keeps a range from also drawing as a plain shape", () => {
    const range = createRange([
      { latitude: 1, longitude: 2 },
      { latitude: 4, longitude: 5 },
    ]);

    expect(transformEntity(range)?.shape).toBeUndefined();
    expect(transformEntity(range)?.pathPoints).toHaveLength(2);
  });
});

describe("buildDelta", () => {
  beforeEach(() => resetDeltaState());

  // Only e2 changed. Marking every entity updated would let a rebuild that just
  // serialises the changed ids look complete.
  it("includes all entities in fullRebuild delta", () => {
    const entities = new Map([
      ["e1", createEntity("e1", 10, 20)],
      ["e2", createEntity("e2", 30, 40)],
      ["e3", createEntity("e3", 50, 60)],
    ]);
    accumulateChanges(createChangeSet(1, ["e2"]));
    const delta = buildDelta(entities, new Set());

    expect(delta.fullRebuild).toBe(true);
    expect(delta.entities.map((entity) => entity.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect(delta.removed).toHaveLength(0);
  });

  it("returns only changed entities for incremental delta", () => {
    const entities1 = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities1, new Set());

    const entities2 = new Map([
      ["e1", createEntity("e1")],
      ["e2", createEntity("e2")],
    ]);
    accumulateChanges(createChangeSet(2, ["e2"]));
    const delta = buildDelta(entities2, new Set());

    expect(delta.fullRebuild).toBeUndefined();
    expect(delta.entities).toHaveLength(1);
    expect(delta.entities[0]?.id).toBe("e2");
  });

  it.each([true, false])("preserves local=%s through every chunk", (local) => {
    const entities = new Map([
      ["e1", createEntity("e1", 51.3, -2.7)],
      ["e2", createEntity("e2", 48.9, 1.4)],
      ["e3", createEntity("e3", 63.2, 7.8)],
    ]);
    accumulateChanges(createChangeSet(1, [...entities.keys()]));
    buildDelta(entities, new Set());
    accumulateChanges({ ...createChangeSet(2, [...entities.keys()]), local });

    const chunks = [...buildDeltaChunked(entities, new Set(), 2)];

    expect(chunks.map((chunk) => chunk.entities.map((entity) => entity.id))).toEqual([
      ["e1", "e2"],
      ["e3"],
    ]);
    expect(chunks.map((chunk) => chunk.local)).toEqual([local, local]);
  });

  it("handles clear-all then add-new via sequential incremental deltas", () => {
    const entities = new Map([
      ["e1", createEntity("e1", 10, 20)],
      ["e2", createEntity("e2", 30, 40)],
      ["e3", createEntity("e3", 50, 60)],
    ]);
    accumulateChanges(createChangeSet(1, ["e1", "e2", "e3"]));
    buildDelta(entities, new Set());

    accumulateChanges({
      version: 2,
      updatedIds: new Set(),
      deletedIds: new Set(["e1", "e2", "e3"]),
      geoChanged: true,
    });
    const clearDelta = buildDelta(new Map(), new Set());

    expect(clearDelta.fullRebuild).toBeUndefined();
    expect(clearDelta.removed).toHaveLength(3);
    expect(clearDelta.entities).toHaveLength(0);

    accumulateChanges({
      version: 3,
      updatedIds: new Set(["n1"]),
      deletedIds: new Set(),
      geoChanged: true,
    });
    const addDelta = buildDelta(new Map([["n1", createEntity("n1", 1, 2)]]), new Set());

    expect(addDelta.fullRebuild).toBeUndefined();
    expect(addDelta.entities).toHaveLength(1);
    expect(addDelta.entities[0]?.id).toBe("n1");
    expect(addDelta.removed).toHaveLength(0);
  });
});

describe("expiry is engine-driven, not local-clock", () => {
  beforeEach(() => resetDeltaState());

  function expiredEntity(id: string): Entity {
    return {
      id,
      geo: { latitude: 0, longitude: 0, altitude: 0 },
      symbol: { milStd2525C: "SFGPU------" },
      lifetime: { until: { seconds: BigInt(1), nanos: 0 } },
    } as Entity;
  }

  it("keeps an entity whose lifetime.until is already past", () => {
    const entities = new Map([["e1", expiredEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    const delta = buildDelta(entities, new Set());

    expect(delta.entities).toHaveLength(1);
    expect(delta.entities[0]?.id).toBe("e1");
    expect(delta.removed).toHaveLength(0);
  });
});

describe("accumulateChanges", () => {
  beforeEach(() => resetDeltaState());

  it("merges multiple changes (union of IDs)", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities, new Set());

    accumulateChanges(createChangeSet(2, ["e2"]));
    accumulateChanges(createChangeSet(3, ["e3"]));

    const entities2 = new Map([
      ["e1", createEntity("e1")],
      ["e2", createEntity("e2")],
      ["e3", createEntity("e3")],
    ]);
    const delta = buildDelta(entities2, new Set());
    expect(delta.entities).toHaveLength(2);
    const ids = delta.entities.map((e) => e.id).sort();
    expect(ids).toEqual(["e2", "e3"]);
  });

  it("delete overwrites update for same ID", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities, new Set());

    accumulateChanges(createChangeSet(2, ["e2"]));
    accumulateChanges({
      version: 3,
      updatedIds: new Set(),
      deletedIds: new Set(["e2"]),
      geoChanged: false,
    });

    const delta = buildDelta(new Map([["e1", createEntity("e1")]]), new Set());
    expect(delta.entities).toHaveLength(0);
    expect(delta.removed).toContain("e2");
  });

  it("update overwrites delete for same ID", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities, new Set());

    accumulateChanges({
      version: 2,
      updatedIds: new Set(),
      deletedIds: new Set(["e2"]),
      geoChanged: false,
    });
    accumulateChanges(createChangeSet(3, ["e2"]));

    const entities2 = new Map([
      ["e1", createEntity("e1")],
      ["e2", createEntity("e2")],
    ]);
    const delta = buildDelta(entities2, new Set());
    expect(delta.entities).toHaveLength(1);
    expect(delta.entities[0]?.id).toBe("e2");
    expect(delta.removed).not.toContain("e2");
  });

  it("buildDelta consumes and clears accumulated sets", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities, new Set());

    accumulateChanges(createChangeSet(2, ["e2"]));
    const entities2 = new Map([
      ["e1", createEntity("e1")],
      ["e2", createEntity("e2")],
    ]);
    const delta2 = buildDelta(entities2, new Set());
    expect(delta2.entities).toHaveLength(1);

    // Same version with no new accumulation returns cached result
    const cachedDelta = buildDelta(entities2, new Set());
    expect(cachedDelta).toBe(delta2);

    // After a new version with no actual changes, delta should be empty
    accumulateChanges(createChangeSet(3, []));
    const emptyDelta = buildDelta(entities2, new Set());
    expect(emptyDelta.entities).toHaveLength(0);
    expect(emptyDelta.removed).toHaveLength(0);
  });

  it("consumes a local write flag with a full rebuild", () => {
    const entities = new Map([["e1", createEntity("e1", 51.3, -2.7)]]);
    accumulateChanges({ ...createChangeSet(1, ["e1"]), local: true });
    expect(buildDelta(entities, new Set()).fullRebuild).toBe(true);

    accumulateChanges(createChangeSet(2, ["e1"]));
    const next = buildDelta(entities, new Set());

    expect(next.fullRebuild).toBeUndefined();
    expect(next.local).toBe(false);
  });

  // The rebuild straight after a reset never carries local at all, so a stale flag
  // only surfaces on the delta after that one. An assertion on the rebuild passes either way.
  it("resetDeltaState clears an unconsumed local flag", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges({
      version: 1,
      updatedIds: new Set(["e1"]),
      deletedIds: new Set(),
      geoChanged: true,
      local: true,
    });

    resetDeltaState();

    accumulateChanges(createChangeSet(2, ["e1"]));
    expect(buildDelta(entities, new Set()).fullRebuild).toBe(true);

    accumulateChanges(createChangeSet(3, ["e1"]));
    expect(buildDelta(entities, new Set()).local).toBeFalsy();
  });

  // Asserting only the true case passes even if the flag is hardcoded true, so
  // both outcomes have to come from the accumulated change.
  it.each([true, false])("tracks geoChanged=%s across accumulated changes", (geoChanged) => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities, new Set());

    accumulateChanges({
      version: 2,
      updatedIds: new Set(["e1"]),
      deletedIds: new Set(),
      geoChanged,
    });

    expect(buildDelta(entities, new Set()).geoChanged).toBe(geoChanged);
  });
});

describe("stream reconnection", () => {
  function buildEntityMap(count: number) {
    const map = new Map<string, Entity>();
    for (let i = 0; i < count; i++) {
      map.set(`e${i}`, createEntity(`e${i}`, Math.random() * 180 - 90, Math.random() * 360 - 180));
    }
    return map;
  }

  beforeEach(() => resetDeltaState());

  it("fullClear from stream reconnection still works", () => {
    const entities = buildEntityMap(1000);
    const allIds = Array.from(entities.keys());

    accumulateChanges(createChangeSet(1, allIds));
    buildDelta(entities, new Set());

    // stream reconnection sends fullClear with empty sets
    accumulateChanges({
      version: 2,
      updatedIds: new Set(),
      deletedIds: new Set(),
      geoChanged: true,
      fullClear: true,
    });

    // after reconnection, new entities arrive
    const newEntities = buildEntityMap(500);
    const newIds = Array.from(newEntities.keys());
    accumulateChanges(createChangeSet(3, newIds));

    const delta = buildDelta(newEntities, new Set());
    expect(delta.fullRebuild).toBe(true);
    expect(delta.entities).toHaveLength(500);
  });
});

// A vertex average and a bounding-box midpoint agree on any outline whose points
// are evenly spread, and two points can never tell them apart at all. Every
// fixture here is skewed in longitude so only the average lands on the answer.
describe("shapeCentroid", () => {
  it("averages a polygon that stays inside one world", () => {
    const centroid = shapeCentroid({
      type: "polygon",
      outer: [
        { lat: 0, lng: 10 },
        { lat: 1, lng: 11 },
        { lat: 4, lng: 24 },
      ],
    });

    // the bounding box is centred on 17, the vertices average 15
    expect(centroid?.lat).toBeCloseTo(5 / 3, 6);
    expect(centroid?.lng).toBeCloseTo(15, 6);
  });

  it("keeps a polygon spanning the antimeridian on its own side", () => {
    const centroid = shapeCentroid({
      type: "polygon",
      outer: [
        { lat: 0, lng: 179 },
        { lat: 0, lng: -179 },
        { lat: 2, lng: -175 },
      ],
    });

    // raw averaging gives -58.3. unwrapped the points are 179, 181, 185, whose
    // average is 181.667 and whose bounding box is centred on 182.
    expect(centroid?.lng).toBeCloseTo(-178.333_333, 5);
    expect(centroid?.lat).toBeCloseTo(2 / 3, 6);
  });

  it("wraps a centroid that lands past the antimeridian back into range", () => {
    const centroid = shapeCentroid({
      type: "polyline",
      points: [
        { lat: 0, lng: 178 },
        { lat: 0, lng: -179 },
        { lat: 0, lng: -174 },
      ],
    });

    // unwrapped 178, 181, 186: the average of 181.667 is past the antimeridian
    expect(centroid?.lng).toBeCloseTo(-178.333_333, 5);
  });
});

// The write and the read are separate paths over the same proto, and every loss
// they have had so far was invisible to a test of either side alone.
describe("writeDrawing then readDrawing", () => {
  const CENTRE = { type: "coordinate", position: { lat: 1, lng: 2 } } as const;
  const EDGE = { type: "coordinate", position: { lat: 1, lng: 2.01 } } as const;

  function roundTrip(
    kind: EditKind,
    points: readonly PathPoint[],
    rings?: number,
    radiusM?: number,
  ) {
    return readDrawing({
      id: "shape",
      controller: { id: CONTROLLER_ID },
      shape: writeDrawing(kind, points, rings, radiusM),
      metric: writeMetrics(kind, points, rings, radiusM),
    } as Entity);
  }

  it("keeps a two-point freeform distinct from a range and bearing", () => {
    expect(roundTrip("freeform", [CENTRE, EDGE])?.kind).toBe("freeform");
  });

  it("keeps a two-point range and bearing distinct from a freeform", () => {
    expect(roundTrip("range", [CENTRE, EDGE])?.kind).toBe("range");
  });

  it("keeps a ring set's count", () => {
    expect(roundTrip("rb-circle", [CENTRE, EDGE], 4)?.rings).toBe(4);
  });

  it("keeps a circle's authoritative radius", () => {
    expect(roundTrip("circle", [CENTRE, EDGE], undefined, 1234)?.radiusM).toBe(1234);
  });

  it.each([0, 6])("keeps an anchored vertex's snapshot at altitude %i", (alt) => {
    const anchored = {
      type: "entity",
      entityId: "track-1",
      lastKnownPosition: { lat: 4, lng: 5, alt },
    } as const;

    expect(roundTrip("range", [CENTRE, anchored])?.points[1]).toEqual(anchored);
  });

  // Two passes of the same geodesy land nanometres apart, so the corners are
  // compared with a tolerance rather than bit for bit.
  const corners = (shape: ReturnType<typeof roundTrip>) =>
    shape!.points.flatMap((point) =>
      point.type === "coordinate" ? [point.position.lat, point.position.lng] : [],
    );

  // Raw taps survive a round trip too, so idempotence alone proves nothing. The
  // third point has to be square to the first edge, which a raw tap is not.
  it("hands back corners rather than the taps that made them", () => {
    const skewed = { type: "coordinate", position: { lat: 1.01, lng: 2.05 } } as const;
    const read = roundTrip("rectangle", [CENTRE, EDGE, skewed]);
    const [a, b, c] = read!.points.flatMap((point) =>
      point.type === "coordinate" ? [point.position] : [],
    );

    expect(read?.kind).toBe("rectangle");
    const alongEdge = initialBearing(toGeoPoint(a!), toGeoPoint(b!));
    const intoDepth = initialBearing(toGeoPoint(b!), toGeoPoint(c!));
    expect(Math.abs(((intoDepth - alongEdge + 540) % 360) - 180)).toBeCloseTo(90, 1);
  });

  it("rebuilds the same rectangle from the corners it handed back", () => {
    const skewed = { type: "coordinate", position: { lat: 1.01, lng: 2.05 } } as const;
    const read = roundTrip("rectangle", [CENTRE, EDGE, skewed]);
    const rebuilt = roundTrip("rectangle", read!.points);

    expect(corners(rebuilt)).toHaveLength(6);
    corners(rebuilt).forEach((value, index) => expect(value).toBeCloseTo(corners(read)[index]!, 9));
  });
});
