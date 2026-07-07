import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { classifyEvent } from "./process-events";

const Updated = EntityChange.EntityChangeUpdated;
const Expired = EntityChange.EntityChangeExpired;
const Unobserved = EntityChange.EntityChangeUnobserved;

function entity(id: string): Entity {
  return {
    id,
    geo: { latitude: 0, longitude: 0, altitude: 0 },
    symbol: { milStd2525C: "SFGPU------" },
  } as Entity;
}

function classify(events: Array<{ entity?: Entity; t: EntityChange }>) {
  const updates = new Map<string, Entity>();
  const deletes = new Set<string>();
  for (const event of events) {
    classifyEvent(event, updates, deletes);
  }
  return { updates, deletes };
}

describe("classifyEvent", () => {
  it("skips events with no entity", () => {
    const { updates, deletes } = classify([{ entity: undefined, t: Updated }]);
    expect(updates.size).toBe(0);
    expect(deletes.size).toBe(0);
  });

  it("skips events with empty entity id", () => {
    const { updates, deletes } = classify([{ entity: { id: "" } as Entity, t: Updated }]);
    expect(updates.size).toBe(0);
    expect(deletes.size).toBe(0);
  });

  it("Updated entities land in updates", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Updated },
      { entity: entity("b"), t: Updated },
    ]);
    expect(updates.size).toBe(2);
    expect(deletes.size).toBe(0);
  });

  it("Expired events land in deletes", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Expired },
      { entity: entity("b"), t: Expired },
    ]);
    expect(updates.size).toBe(0);
    expect(deletes.size).toBe(2);
  });

  it("Unobserved events land in deletes", () => {
    const { updates, deletes } = classify([{ entity: entity("a"), t: Unobserved }]);
    expect(deletes.has("a")).toBe(true);
    expect(updates.has("a")).toBe(false);
  });

  it("delete then re-add — ends in updates", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Expired },
      { entity: entity("a"), t: Updated },
    ]);
    expect(updates.has("a")).toBe(true);
    expect(deletes.has("a")).toBe(false);
  });

  it("update then expire — ends in deletes", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Updated },
      { entity: entity("a"), t: Expired },
    ]);
    expect(updates.has("a")).toBe(false);
    expect(deletes.has("a")).toBe(true);
  });

  it("unobserved then re-observed — ends in updates", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Unobserved },
      { entity: entity("a"), t: Updated },
    ]);
    expect(updates.has("a")).toBe(true);
    expect(deletes.has("a")).toBe(false);
  });

  it("last-writer-wins: later update replaces earlier", () => {
    const v1 = entity("a");
    const v2 = entity("a");
    (v1 as Record<string, unknown>).label = "v1";
    (v2 as Record<string, unknown>).label = "v2";
    const { updates } = classify([
      { entity: v1, t: Updated },
      { entity: v2, t: Updated },
    ]);
    expect((updates.get("a") as Record<string, unknown>)?.label).toBe("v2");
  });

  it("entity never in both updates and deletes", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Updated },
      { entity: entity("a"), t: Expired },
      { entity: entity("a"), t: Updated },
      { entity: entity("b"), t: Updated },
      { entity: entity("b"), t: Unobserved },
    ]);
    for (const id of updates.keys()) {
      expect(deletes.has(id)).toBe(false);
    }
    for (const id of deletes) {
      expect(updates.has(id)).toBe(false);
    }
  });

  it("unhandled changeType 0 — ignored", () => {
    const { updates, deletes } = classify([{ entity: entity("a"), t: 0 as EntityChange }]);
    expect(updates.size).toBe(0);
    expect(deletes.size).toBe(0);
  });
});
