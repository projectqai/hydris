import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from "react";
import { type GestureResponderEvent, StyleSheet, View } from "react-native";

import type { PressOutsideTarget } from "./press-outside";

const TOUCH_SLOP = 8;

const STYLES = StyleSheet.create({ root: { flex: 1 } });

type Listener = { press: () => void };

type PressOutsideRegistry = {
  listen: (listener: Listener) => () => void;
  markInside: (listener: Listener) => void;
};

const PressOutsideContext = createContext<PressOutsideRegistry | null>(null);

// Android has no outside-touch event for a view inside the app's one window.
// A touch bubbles to the root when no view claims it, so the root sees every touch.
// A control marks the touches that start on it as they bubble past.
export function PressOutsideRoot({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const inside = useRef(new Set<Listener>());
  const start = useRef<{ x: number; y: number }>(undefined);

  const registry = useMemo<PressOutsideRegistry>(
    () => ({
      listen: (listener) => {
        listeners.current.add(listener);

        return () => listeners.current.delete(listener);
      },
      markInside: (listener) => inside.current.add(listener),
    }),
    [],
  );

  const onTouchStart = (event: GestureResponderEvent) => {
    start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  };

  const onTouchEnd = (event: GestureResponderEvent) => {
    const from = start.current;

    const pressed =
      from !== undefined &&
      Math.abs(event.nativeEvent.pageX - from.x) <= TOUCH_SLOP &&
      Math.abs(event.nativeEvent.pageY - from.y) <= TOUCH_SLOP;

    if (pressed) {
      for (const listener of listeners.current) {
        if (!inside.current.has(listener)) listener.press();
      }
    }

    start.current = undefined;
    inside.current.clear();
  };

  const onTouchCancel = () => {
    start.current = undefined;
    inside.current.clear();
  };

  return (
    <PressOutsideContext value={registry}>
      <View
        style={STYLES.root}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {children}
      </View>
    </PressOutsideContext>
  );
}

export function usePressOutside(
  _node: RefObject<View | null>,
  onPressOutside: (() => void) | undefined,
): PressOutsideTarget {
  const registry = use(PressOutsideContext);
  const listening = onPressOutside !== undefined;
  const press = useEffectEvent(() => onPressOutside?.());
  const listener = useRef<Listener>({ press: () => press() });

  useEffect(() => {
    if (!registry || !listening) return;

    return registry.listen(listener.current);
  }, [registry, listening]);

  return { onTouchStart: () => registry?.markInside(listener.current) };
}
