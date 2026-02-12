import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { classifyEvent } from "./process-events";

const Updated = EntityChange.EntityChangeUpdated;
const Expired = EntityChange.EntityChangeExpired;
const Unobserved = EntityChange.EntityChangeUnobserved;

function entity(id: string, expired = false): Entity {
  return {
    id,
    geo: { latitude: 0, longitude: 0, altitude: 0 },
    symbol: { milStd2525C: "SFGPU------" },
    ...(expired ? { lifetime: { until: { seconds: BigInt(0), nanos: 0 } } } : {}),
  } as Entity;
}

const neverExpired = () => false;
const expiredByFlag = (e: Entity) => !!e.lifetime?.until;

function classify(
  events: Array<{ entity?: Entity; t: EntityChange }>,
  isExpiredFn: (e: Entity) => boolean = neverExpired,
) {
  const updates = new Map<string, Entity>();
  const deletes = new Set<string>();
  for (const event of events) {
    classifyEvent(event, updates, deletes, isExpiredFn);
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

  it("Updated(expired) routes to deletes", () => {
    const { updates, deletes } = classify(
      [{ entity: entity("a", true), t: Updated }],
      expiredByFlag,
    );
    expect(updates.size).toBe(0);
    expect(deletes.has("a")).toBe(true);
  });

  it("ec clear: Updated(expired) then Expired — in deletes", () => {
    const { updates, deletes } = classify(
      [
        { entity: entity("a", true), t: Updated },
        { entity: entity("a"), t: Expired },
      ],
      expiredByFlag,
    );
    expect(updates.size).toBe(0);
    expect(deletes.has("a")).toBe(true);
  });

  it("ec clear: Expired then Updated(expired) — still in deletes", () => {
    const { updates, deletes } = classify(
      [
        { entity: entity("a"), t: Expired },
        { entity: entity("a", true), t: Updated },
      ],
      expiredByFlag,
    );
    expect(updates.size).toBe(0);
    expect(deletes.has("a")).toBe(true);
  });

  it("ec clear interleaved with live entities", () => {
    const { updates, deletes } = classify(
      [
        { entity: entity("live1"), t: Updated },
        { entity: entity("dead1", true), t: Updated },
        { entity: entity("live2"), t: Updated },
        { entity: entity("dead1"), t: Expired },
      ],
      expiredByFlag,
    );
    expect(updates.size).toBe(2);
    expect(updates.has("live1")).toBe(true);
    expect(updates.has("live2")).toBe(true);
    expect(deletes.size).toBe(1);
    expect(deletes.has("dead1")).toBe(true);
  });

  it("delete then re-add — ends in updates", () => {
    const { updates, deletes } = classify([
      { entity: entity("a"), t: Expired },
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
    const { updates, deletes } = classify(
      [
        { entity: entity("a"), t: Updated },
        { entity: entity("a"), t: Expired },
        { entity: entity("a"), t: Updated },
        { entity: entity("a", true), t: Updated },
      ],
      expiredByFlag,
    );
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
