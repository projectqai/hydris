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

  it("unhandled changeType 0 — ignored", () => {
    const { updates, deletes } = classify([{ entity: entity("a"), t: 0 as EntityChange }]);
    expect(updates.size).toBe(0);
    expect(deletes.size).toBe(0);
  });
});
