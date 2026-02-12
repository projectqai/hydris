import type { Entity } from "@projectqai/proto/world";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChangeSet } from "../store/entity-store";
import { accumulateChanges, buildDelta, resetDeltaState } from "./transform-entities";

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

describe("buildDelta", () => {
  beforeEach(() => resetDeltaState());

  it("sets fullRebuild=true on initial build", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    const delta = buildDelta(entities, new Set());

    expect(delta.fullRebuild).toBe(true);
  });

  it("does not set fullRebuild after initial build", () => {
    const entities1 = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities1, new Set());

    const entities2 = new Map([
      ["e1", createEntity("e1")],
      ["e2", createEntity("e2")],
    ]);
    accumulateChanges(createChangeSet(3, ["e2"]));
    const delta = buildDelta(entities2, new Set());

    expect(delta.fullRebuild).toBeUndefined();
  });

  it("includes all entities in fullRebuild delta", () => {
    const entities = new Map([
      ["e1", createEntity("e1", 10, 20)],
      ["e2", createEntity("e2", 30, 40)],
    ]);
    accumulateChanges(createChangeSet(1, ["e1", "e2"]));
    const delta = buildDelta(entities, new Set());

    expect(delta.fullRebuild).toBe(true);
    expect(delta.entities).toHaveLength(2);
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

  it("includes deleted ids in incremental delta", () => {
    const entities1 = new Map([
      ["e1", createEntity("e1")],
      ["e2", createEntity("e2")],
    ]);
    accumulateChanges(createChangeSet(1, ["e1", "e2"]));
    buildDelta(entities1, new Set());

    const entities2 = new Map([["e1", createEntity("e1")]]);
    accumulateChanges({
      version: 2,
      updatedIds: new Set(),
      deletedIds: new Set(["e2"]),
      geoChanged: true,
    });
    const delta = buildDelta(entities2, new Set());

    expect(delta.fullRebuild).toBeUndefined();
    expect(delta.removed).toContain("e2");
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
    buildDelta(entities2, new Set());

    // Second build with no new changes should produce empty delta
    const emptyDelta = buildDelta(entities2, new Set());
    expect(emptyDelta.entities).toHaveLength(0);
    expect(emptyDelta.removed).toHaveLength(0);
  });

  it("resetDeltaState clears accumulated sets", () => {
    accumulateChanges(createChangeSet(1, ["e1"]));
    resetDeltaState();

    // After reset, next build should be fullRebuild (isFirstBuild = true)
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(2, ["e1"]));
    const delta = buildDelta(entities, new Set());
    expect(delta.fullRebuild).toBe(true);
  });

  it("tracks geoChanged across accumulated changes", () => {
    const entities = new Map([["e1", createEntity("e1")]]);
    accumulateChanges(createChangeSet(1, ["e1"]));
    buildDelta(entities, new Set());

    accumulateChanges({
      version: 2,
      updatedIds: new Set(["e1"]),
      deletedIds: new Set(),
      geoChanged: true,
    });

    const delta = buildDelta(entities, new Set());
    expect(delta.geoChanged).toBe(true);
  });
});

describe("massDeletion (10k remove from 100k)", () => {
  const TOTAL = 100_000;
  const DELETE_COUNT = 10_000;

  function buildEntityMap(count: number) {
    const map = new Map<string, Entity>();
    for (let i = 0; i < count; i++) {
      map.set(`e${i}`, createEntity(`e${i}`, Math.random() * 180 - 90, Math.random() * 360 - 180));
    }
    return map;
  }

  beforeEach(() => resetDeltaState());

  it("sends delete IDs instead of fullRebuild (the crash fix)", () => {
    const entities = buildEntityMap(TOTAL);
    const allIds = Array.from(entities.keys());

    // initial load — drain all batches
    accumulateChanges(createChangeSet(1, allIds));
    const initial = buildDelta(entities, new Set());
    expect(initial.fullRebuild).toBe(true);
    expect(initial.entities).toHaveLength(TOTAL);

    // delete 10k — simulates entity-store massDeletion path (after fix)
    const deleteIds = allIds.slice(0, DELETE_COUNT);
    for (const id of deleteIds) entities.delete(id);

    accumulateChanges({
      version: 2,
      updatedIds: new Set(),
      deletedIds: new Set(deleteIds),
      geoChanged: true,
    });

    const delta = buildDelta(entities, new Set());

    // must NOT be fullRebuild — that's what caused the OOM
    expect(delta.fullRebuild).toBeUndefined();
    expect(delta.removed).toHaveLength(DELETE_COUNT);
    expect(delta.entities).toHaveLength(0);
    expect(delta.geoChanged).toBe(true);

    // the JSON that crosses the DOM bridge should be small
    const json = JSON.stringify(delta);
    const jsonSizeMB = json.length / 1024 / 1024;
    expect(jsonSizeMB).toBeLessThan(1); // ~200KB vs ~50MB with fullRebuild
  });

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
