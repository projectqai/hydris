"use no memo";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyboardShortcut } from "../keyboard";

// keyboard highlight for the command-palette sidebars whose rows reflow as
// groups expand and collapse. it tracks the highlight by row key rather than
// index so it survives the reflow, and scrolls the highlighted row into view.
// arrow keys move the highlight. Enter is left to the caller since what it does
// depends on the row. the flat FlashList views use the index-based useListNav.
export function useKeyedListNav<T extends { key: string }>({
  rows,
  guard,
  initialKey,
}: {
  rows: readonly T[];
  guard?: () => boolean;
  initialKey?: string | null;
}) {
  const [highlightedKey, setHighlightedKey] = useState<string | null>(initialKey ?? null);
  const highlightedElRef = useRef<HTMLElement | null>(null);

  const highlightedIndex = useMemo(() => {
    if (highlightedKey) {
      const idx = rows.findIndex((r) => r.key === highlightedKey);
      if (idx >= 0) return idx;
    }
    return rows.length > 0 ? 0 : -1;
  }, [rows, highlightedKey]);

  const setHighlightedEl = useCallback((node: unknown) => {
    highlightedElRef.current = node as HTMLElement | null;
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0) {
      highlightedElRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlightedIndex]);

  useKeyboardShortcut(
    "ArrowDown",
    useCallback(() => {
      if (guard?.()) return false;
      const next = highlightedIndex + 1;
      if (next < rows.length) setHighlightedKey(rows[next]!.key);
      return true;
    }, [guard, highlightedIndex, rows]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "ArrowUp",
    useCallback(() => {
      if (guard?.()) return false;
      const prev = highlightedIndex - 1;
      if (prev >= 0) setHighlightedKey(rows[prev]!.key);
      return true;
    }, [guard, highlightedIndex, rows]),
    { priority: 200 },
  );

  return { highlightedKey, setHighlightedKey, highlightedIndex, setHighlightedEl };
}
