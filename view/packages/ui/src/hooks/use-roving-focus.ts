import { createContext, useCallback, useRef } from "react";
import type { View } from "react-native";

export type RovingItem = { index: number; disabled: boolean; node: View };

export const ItemIndexContext = createContext(0);

export function useRovingFocus() {
  const items = useRef(new Map<string, RovingItem>());

  const registerItem = useCallback((value: string, item: RovingItem) => {
    items.current.set(value, item);

    return () => {
      if (items.current.get(value) === item) items.current.delete(value);
    };
  }, []);

  const focusItem = useCallback((value: string) => items.current.get(value)?.node.focus(), []);

  const moveFocus = useCallback((from: string, step: number, wrap: boolean) => {
    const order = [...items.current.entries()]
      .filter(([, item]) => !item.disabled)
      .sort(([, a], [, b]) => a.index - b.index);

    const at = order.findIndex(([value]) => value === from);
    const [next, item] = (wrap ? order.at((at + step) % order.length) : order[at + step]) ?? [];

    item?.node.focus();

    return next;
  }, []);

  return { registerItem, focusItem, moveFocus };
}
