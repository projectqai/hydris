"use no memo";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyboardShortcut } from "../keyboard";
import { focusedControlOwnsEnter } from "./use-list-nav";

function stepGrid(
  selectable: readonly number[],
  cellOf: (index: number) => number,
  prev: number,
  step: number,
): number {
  if (prev < 0) return selectable[0] ?? prev;

  const target = cellOf(prev) + step;

  if (step > 0) return selectable.find((i) => cellOf(i) >= target) ?? prev;

  const before = selectable.filter((i) => cellOf(i) <= target);

  return before.at(-1) ?? prev;
}

export function useKeyedListNav<T extends { key: string }>({
  rows,
  guard,
  fallbackKey,
  columns,
  cells,
  isSelectable,
  onActivate,
  yieldToFocus = false,
}: {
  rows: readonly T[];
  guard?: () => boolean;
  fallbackKey?: string;
  columns?: number;
  cells?: readonly number[];
  isSelectable?: (row: T) => boolean;
  onActivate?: (row: T) => void;
  yieldToFocus?: boolean;
}) {
  const shortcut = { priority: 200, yieldToFocus };

  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);

  const selectable = useMemo(
    () => rows.flatMap((row, i) => (!isSelectable || isSelectable(row) ? [i] : [])),
    [rows, isSelectable],
  );

  const isGrid = !!columns;

  const highlightedIndex = useMemo(() => {
    const idx = highlightedKey ? rows.findIndex((r) => r.key === highlightedKey) : -1;

    if (idx >= 0 || isGrid) return idx;

    const fallback = fallbackKey ? rows.findIndex((r) => r.key === fallbackKey) : -1;

    return fallback >= 0 ? fallback : (selectable[0] ?? -1);
  }, [rows, highlightedKey, isGrid, selectable, fallbackKey]);

  const setHighlightedEl = useCallback((node: unknown) => {
    highlightedElRef.current = node as HTMLElement | null;
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0) {
      highlightedElRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const move = useCallback(
    (step: number) => {
      if (guard?.()) return false;

      const cellOf = (index: number) => cells?.[index] ?? index;
      const next = rows[stepGrid(selectable, cellOf, highlightedIndex, step)];

      if (next) setHighlightedKey(next.key);

      return true;
    },
    [guard, rows, cells, selectable, highlightedIndex],
  );

  useKeyboardShortcut(
    "ArrowDown",
    useCallback(() => move(columns ?? 1), [move, columns]),
    shortcut,
  );

  useKeyboardShortcut(
    "ArrowUp",
    useCallback(() => move(-(columns ?? 1)), [move, columns]),
    shortcut,
  );

  useKeyboardShortcut(
    "ArrowRight",
    useCallback(() => isGrid && move(1), [move, isGrid]),
    shortcut,
  );

  useKeyboardShortcut(
    "ArrowLeft",
    useCallback(() => isGrid && move(-1), [move, isGrid]),
    shortcut,
  );

  useKeyboardShortcut(
    "Enter",
    useCallback(() => {
      const row = rows[highlightedIndex];

      if (!onActivate || !row || guard?.() || focusedControlOwnsEnter()) return false;

      onActivate(row);

      return true;
    }, [onActivate, rows, highlightedIndex, guard]),
    shortcut,
  );

  return { highlightedKey, setHighlightedKey, highlightedIndex, setHighlightedEl };
}
