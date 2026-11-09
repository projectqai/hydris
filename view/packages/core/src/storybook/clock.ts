import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";

export const STORY_NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

export function ago(seconds: number): Timestamp {
  return timestampFromMs(STORY_NOW - seconds * 1000);
}

export function ahead(seconds: number): Timestamp {
  return timestampFromMs(STORY_NOW + seconds * 1000);
}

let freshCalls = 0;

// each call is later than the last, as each push from a controller is
export function nextFresh(): Timestamp {
  freshCalls += 1;

  return ahead(freshCalls);
}

// HH:mm:ss in the viewer's time zone, the same in every locale
export function localClock(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

export function startClock(): () => void {
  const RealDate = globalThis.Date;
  const offset = STORY_NOW - RealDate.now();
  const now = () => RealDate.now() + offset;

  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (target, property, receiver) =>
      property === "now" ? now : Reflect.get(target, property, receiver),
  });

  return () => {
    globalThis.Date = RealDate;
  };
}

const heldTimeouts = new Map<number, () => void>();

export function holdTimeouts(delay: number): () => void {
  const { setTimeout: realSetTimeout, clearTimeout: realClearTimeout } = window;
  let nextNegativeId = -1;

  window.setTimeout = ((
    handler: string | ((...args: unknown[]) => void),
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (timeout !== delay || typeof handler !== "function") {
      return realSetTimeout(handler, timeout, ...args);
    }

    const id = nextNegativeId--;

    heldTimeouts.set(id, () => handler(...args));

    return id;
  }) as typeof window.setTimeout;

  window.clearTimeout = ((id?: number) => {
    if (id !== undefined && heldTimeouts.delete(id)) return;

    realClearTimeout(id);
  }) as typeof window.clearTimeout;

  return () => {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
    heldTimeouts.clear();
  };
}

export function elapseHeldTimeouts() {
  const due = [...heldTimeouts.values()];

  heldTimeouts.clear();
  due.forEach((fire) => fire());
}

// A timer's state update renders on a later task, so checking that nothing changed waits a frame
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
