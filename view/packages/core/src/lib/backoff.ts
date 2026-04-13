export type Backoff = {
  next(): number;
  reset(): void;
};

export function createBackoff(initialMs: number, maxMs: number): Backoff {
  let delay = initialMs;

  return {
    next() {
      const current = delay;
      delay = Math.min(delay * 2, maxMs);
      return current;
    },
    reset() {
      delay = initialMs;
    },
  };
}
