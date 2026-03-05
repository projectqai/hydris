"use no memo";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { useKeyboardShortcut } from "../keyboard";

const alwaysTrue = () => true;

type SavedState = { highlightedIndex: number; scrollOffset: number };
const savedStates = new Map<string, SavedState>();

export function clearSavedHighlights() {
  savedStates.clear();
}

export function useListNav<T>({
  items,
  isSelectable,
  onActivate,
  resetKey,
  stateKey,
}: {
  items: readonly T[];
  isSelectable?: (item: T) => boolean;
  onActivate: (item: T) => void;
  resetKey: string;
  stateKey?: string;
}) {
  const checkSelectable = isSelectable ?? alwaysTrue;
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const listRef = useRef<any>(null);
  const highlightedIndexRef = useRef(highlightedIndex);
  highlightedIndexRef.current = highlightedIndex;
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const scrollOffsetRef = useRef(0);
  const isFirstMount = useRef(true);
  const isRestoringRef = useRef(false);
  const mountedRef = useRef(true);

  const selectableIndices = useMemo(
    () =>
      items.reduce<number[]>((acc, item, i) => {
        if (checkSelectable(item)) acc.push(i);
        return acc;
      }, []),
    [items, checkSelectable],
  );

  const selectableIndicesRef = useRef(selectableIndices);
  selectableIndicesRef.current = selectableIndices;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Save highlighted index + scroll offset on unmount for back-navigation
  useEffect(() => {
    if (!stateKey) return;
    return () => {
      savedStates.set(stateKey, {
        highlightedIndex: highlightedIndexRef.current,
        scrollOffset: scrollOffsetRef.current,
      });
    };
  }, [stateKey]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (stateKey && savedStates.has(stateKey)) {
        const saved = savedStates.get(stateKey)!;
        isRestoringRef.current = true;
        setHighlightedIndex(saved.highlightedIndex);
        // Defer scroll restore — FlashList needs a frame to lay out before it
        // can scroll. The isRestoringRef flag prevents the scrollIntoView effect
        // from overriding this position on the intermediate re-render.
        requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          listRef.current?.scrollToOffset?.({ offset: saved.scrollOffset, animated: false });
        });
        return;
      }
    }
    setHighlightedIndex(Platform.OS === "web" ? (selectableIndicesRef.current[0] ?? -1) : -1);
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  }, [resetKey, stateKey]);

  useKeyboardShortcut(
    "ArrowDown",
    useCallback(() => {
      setHighlightedIndex((prev) => {
        const pos = selectableIndices.indexOf(prev);
        const next = pos + 1;
        return next < selectableIndices.length ? selectableIndices[next]! : prev;
      });
      return true;
    }, [selectableIndices]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "ArrowUp",
    useCallback(() => {
      setHighlightedIndex((prev) => {
        const pos = selectableIndices.indexOf(prev);
        const next = pos - 1;
        return next >= 0 ? selectableIndices[next]! : prev;
      });
      return true;
    }, [selectableIndices]),
    { priority: 200 },
  );

  useKeyboardShortcut(
    "Enter",
    useCallback(() => {
      if (typeof document !== "undefined") {
        const role = document.activeElement?.getAttribute("role");
        if (role === "switch" || role === "checkbox" || role === "slider") return false;
      }
      if (highlightedIndex >= 0 && highlightedIndex < items.length) {
        onActivate(items[highlightedIndex]!);
        return true;
      }
      return false;
    }, [highlightedIndex, items, onActivate]),
    { priority: 200 },
  );

  // Track scroll offset for save/restore on back-navigation
  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  // Callback ref — views attach this to the highlighted row's root element
  const setHighlightedEl = useCallback((node: any) => {
    highlightedElRef.current = node;
  }, []);

  // Scroll highlighted item into view using native DOM behavior.
  // block:"nearest" scrolls only if the element is outside the visible area.
  // Skip when restoring — the deferred scrollToOffset handles positioning.
  useEffect(() => {
    if (isRestoringRef.current) {
      // Only consume the flag on the actual restore re-render (index >= 0),
      // not the initial mount render (index = -1).
      if (highlightedIndex >= 0) isRestoringRef.current = false;
      return;
    }
    if (highlightedIndex >= 0) {
      (highlightedElRef.current as HTMLElement)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return { highlightedIndex, setHighlightedIndex, listRef, setHighlightedEl, handleScroll };
}
