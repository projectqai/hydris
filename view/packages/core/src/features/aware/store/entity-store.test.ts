import type { Entity } from "@projectqai/proto/world";
import { EntityChange, Priority } from "@projectqai/proto/world";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watchEntitiesMock = vi.fn();
const getLocalNodeMock = vi.fn(() => new Promise(() => {})); // never resolves by default
const getEntityMock = vi.fn();

vi.mock("../../../lib/api/world-client", () => ({
  worldClient: {
    watchEntities: (...args: unknown[]) =>
      watchEntitiesMock(...(args as Parameters<typeof watchEntitiesMock>)),
    getLocalNode: (...args: unknown[]) =>
      getLocalNodeMock(...(args as Parameters<typeof getLocalNodeMock>)),
    getEntity: (...args: unknown[]) => getEntityMock(...(args as Parameters<typeof getEntityMock>)),
  },
}));

import { ENTITY_STREAM_FILTER, useEntityStore } from "./entity-store";

const Updated = EntityChange.EntityChangeUpdated;
const Expired = EntityChange.EntityChangeExpired;

type StreamEvent = { entity?: Entity; t: EntityChange };

function makeStream() {
  let pushResolve: ((r: IteratorResult<StreamEvent>) => void) | null = null;
  let pushReject: ((e: Error) => void) | null = null;
  const queue: Array<IteratorResult<StreamEvent> | { error: Error }> = [];

  const iterator = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next(): Promise<IteratorResult<StreamEvent>> {
      const item = queue.shift();
      if (item) {
        if ("error" in item) return Promise.reject(item.error);
        return Promise.resolve(item);
      }
      return new Promise((res, rej) => {
        pushResolve = res;
        pushReject = rej;
      });
    },
  };

  const push = (e: StreamEvent) => {
    if (pushResolve) {
      pushResolve({ value: e, done: false });
      pushResolve = null;
      pushReject = null;
    } else {
      queue.push({ value: e, done: false });
    }
  };

  const fail = (err: Error) => {
    if (pushReject) {
      pushReject(err);
      pushResolve = null;
      pushReject = null;
    } else {
      queue.push({ error: err });
    }
  };

  return { iterator, push, fail };
}

function entity(id: string, extra?: Partial<Entity>): Entity {
  return {
    id,
    geo: { latitude: 0, longitude: 0, altitude: 0 },
    symbol: { milStd2525C: "SFGPU------" },
    ...extra,
  } as Entity;
}

// flush all pending microtasks
async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  watchEntitiesMock.mockReset();
  getLocalNodeMock.mockReset();
  getLocalNodeMock.mockReturnValue(new Promise(() => {}));
  useEntityStore.getState().reset();
});

afterEach(() => {
  useEntityStore.getState().reset();
  vi.useRealTimers();
});

describe("startStream", () => {
  it("subscribes to watchEntities with the entity filter", async () => {
    const { iterator } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    expect(watchEntitiesMock).toHaveBeenCalledOnce();
    const [request] = watchEntitiesMock.mock.calls[0] as [{ filter: unknown }];
    expect(request.filter).toEqual(ENTITY_STREAM_FILTER);
  });
});

describe("batching and flush", () => {
  it("first event sets isConnected", async () => {
    const { iterator, push } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    push({ entity: entity("e1"), t: Updated });
    await flushMicrotasks();

    expect(useEntityStore.getState().isConnected).toBe(true);
  });

  it("events are batched and not applied until 250ms elapses", async () => {
    const { iterator, push } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    push({ entity: entity("e1"), t: Updated });
    push({ entity: entity("e2"), t: Updated });
    push({ entity: entity("e3"), t: Updated });
    await flushMicrotasks();

    // not yet flushed
    expect(useEntityStore.getState().entities.size).toBe(0);

    await vi.advanceTimersByTimeAsync(250);

    expect(useEntityStore.getState().entities.size).toBe(3);
    const { updatedIds } = useEntityStore.getState().lastChange;
    expect(updatedIds.has("e1")).toBe(true);
    expect(updatedIds.has("e2")).toBe(true);
    expect(updatedIds.has("e3")).toBe(true);
  });

  it("PriorityImmediate flushes synchronously without waiting for the timer", async () => {
    const { iterator, push } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    push({
      entity: entity("urgent", { priority: Priority.PriorityImmediate }),
      t: Updated,
    });
    await flushMicrotasks();

    // no timer advance needed
    expect(useEntityStore.getState().entities.has("urgent")).toBe(true);
  });

  it("deletes remove entities from the store", async () => {
    const { iterator, push } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // seed
    push({ entity: entity("e1"), t: Updated });
    await vi.advanceTimersByTimeAsync(250);
    expect(useEntityStore.getState().entities.has("e1")).toBe(true);

    // delete
    push({ entity: entity("e1"), t: Expired });
    await vi.advanceTimersByTimeAsync(250);

    expect(useEntityStore.getState().entities.has("e1")).toBe(false);
    expect(useEntityStore.getState().lastChange.deletedIds.has("e1")).toBe(true);
  });

  it("startStream is idempotent — second call does not open a second connection", async () => {
    const { iterator } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    useEntityStore.getState().startStream();
    await flushMicrotasks();

    expect(watchEntitiesMock).toHaveBeenCalledOnce();
  });
});

describe("stop and reconnect", () => {
  it("stopStream sets isConnected false and further events cause no store change", async () => {
    const { iterator, push } = makeStream();
    watchEntitiesMock.mockReturnValue(iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // get connected first
    push({ entity: entity("e1"), t: Updated });
    await vi.advanceTimersByTimeAsync(250);
    expect(useEntityStore.getState().entities.size).toBe(1);

    useEntityStore.getState().stopStream();
    await flushMicrotasks();

    expect(useEntityStore.getState().isConnected).toBe(false);

    // push after stop — should not change entities
    push({ entity: entity("e2"), t: Updated });
    await vi.advanceTimersByTimeAsync(250);

    expect(useEntityStore.getState().entities.has("e2")).toBe(false);
  });

  it("stream error sets error state and schedules a reconnect at the first backoff delay (250ms)", async () => {
    const stream1 = makeStream();
    const stream2 = makeStream();
    let callCount = 0;
    watchEntitiesMock.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? stream1.iterator : stream2.iterator;
    });

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // establish connection first
    stream1.push({ entity: entity("e1"), t: Updated });
    await flushMicrotasks();
    expect(useEntityStore.getState().isConnected).toBe(true);

    // inject error
    stream1.fail(new Error("boom"));
    await flushMicrotasks();

    expect(useEntityStore.getState().error).toBeInstanceOf(Error);
    expect(useEntityStore.getState().isConnected).toBe(false);
    // no reconnect yet — one call so far
    expect(watchEntitiesMock).toHaveBeenCalledTimes(1);

    // advance past first backoff
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    expect(watchEntitiesMock).toHaveBeenCalledTimes(2);
  });

  it("backoff doubles on repeated failure — second reconnect fires after ~500ms", async () => {
    let callCount = 0;
    const streams = [makeStream(), makeStream(), makeStream()];
    watchEntitiesMock.mockImplementation(() => {
      const s = streams[callCount] ?? makeStream();
      callCount++;
      return s.iterator;
    });

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // establish, then fail stream 0
    streams[0]!.push({ entity: entity("e1"), t: Updated });
    await flushMicrotasks();
    streams[0]!.fail(new Error("fail1"));
    await flushMicrotasks();

    // first reconnect at 250ms
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(watchEntitiesMock).toHaveBeenCalledTimes(2);

    // fail stream 1 immediately (no events, so no isConnected set — error path still fires)
    streams[1]!.fail(new Error("fail2"));
    await flushMicrotasks();

    // second reconnect should be at 500ms, not 250ms
    await vi.advanceTimersByTimeAsync(499);
    await flushMicrotasks();
    expect(watchEntitiesMock).toHaveBeenCalledTimes(2); // not yet

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(watchEntitiesMock).toHaveBeenCalledTimes(3);
  });

  it("reconnect wipes entity map and emits fullClear change", async () => {
    const stream1 = makeStream();
    const stream2 = makeStream();
    let callCount = 0;
    watchEntitiesMock.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? stream1.iterator : stream2.iterator;
    });

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // seed entities
    stream1.push({ entity: entity("e1"), t: Updated });
    stream1.push({ entity: entity("e2"), t: Updated });
    await vi.advanceTimersByTimeAsync(250);
    expect(useEntityStore.getState().entities.size).toBe(2);

    // fail the stream
    stream1.fail(new Error("gone"));
    await flushMicrotasks();

    // advance past backoff
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    expect(useEntityStore.getState().entities.size).toBe(0);
    expect(useEntityStore.getState().lastChange.fullClear).toBe(true);
    expect(useEntityStore.getState().lastChange.geoChanged).toBe(true);
  });

  it("no reconnect after stopStream — abort rejection does not wipe entities or schedule a reconnect", async () => {
    const stream1 = makeStream();
    watchEntitiesMock.mockReturnValue(stream1.iterator);

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // seed one entity
    stream1.push({ entity: entity("e1"), t: Updated });
    await vi.advanceTimersByTimeAsync(250);
    expect(useEntityStore.getState().entities.size).toBe(1);

    useEntityStore.getState().stopStream();
    // simulate the abort rejection arriving async after stopStream cleared the controller
    stream1.fail(new Error("aborted"));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    // watchEntities called exactly once, entities untouched, no error set
    expect(watchEntitiesMock).toHaveBeenCalledTimes(1);
    expect(useEntityStore.getState().entities.has("e1")).toBe(true);
    expect(useEntityStore.getState().error).toBeNull();
  });

  it("reconnect wipe clears detections array", async () => {
    const stream1 = makeStream();
    const stream2 = makeStream();
    let callCount = 0;
    watchEntitiesMock.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? stream1.iterator : stream2.iterator;
    });

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // seed one detection and one plain track
    stream1.push({
      entity: entity("d1", { detection: { detectorEntityId: "sensor1" } } as Partial<Entity>),
      t: Updated,
    });
    stream1.push({ entity: entity("t1"), t: Updated });
    // flush (250ms) then derived recompute (500ms)
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    expect(useEntityStore.getState().detections.length).toBe(1);

    // fail the stream, advance past the first backoff so the wipe runs
    stream1.fail(new Error("boom"));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    // stream2 delivers nothing — engine came back empty
    expect(useEntityStore.getState().entities.size).toBe(0);
    expect(useEntityStore.getState().tracks).toEqual([]);
    expect(useEntityStore.getState().detections).toEqual([]);
  });

  it("stop then immediate restart yields exactly one live stream — dead session does not reconnect", async () => {
    const stream1 = makeStream();
    const stream2 = makeStream();
    let callCount = 0;
    watchEntitiesMock.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? stream1.iterator : stream2.iterator;
    });

    useEntityStore.getState().startStream();
    await flushMicrotasks();

    // seed so entities are non-empty (would trigger a fullClear if stray reconnect fires)
    stream1.push({ entity: entity("e1"), t: Updated });
    await vi.advanceTimersByTimeAsync(250);

    useEntityStore.getState().stopStream();
    // old stream rejects after stop, simulating async abort delivery
    stream1.fail(new Error("aborted"));
    // immediately start a new session before the rejection is processed
    useEntityStore.getState().startStream();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    // exactly 2 calls: one per session, no third from the dead session's reconnect
    expect(watchEntitiesMock).toHaveBeenCalledTimes(2);
  });
});
