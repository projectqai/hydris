import type { PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import { KeyboardLayer } from "@hydris/ui/keyboard/keyboard-layer";
import { type ComponentProps, type RefObject, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { getScreen, type ScreenProps } from "./palette-screens";

export const STACK_SCALE = 0.94;

const OPEN_SPRING = { duration: 220, dampingRatio: 1, reduceMotion: ReduceMotion.System };
const CLOSE_SPRING = { duration: 160, dampingRatio: 1, reduceMotion: ReduceMotion.System };

// on web an animation started after a long task gets a frame timestamp from before its start
// and overshoots, so it starts inside a frame
export function onNextFrame(start: () => void): () => void {
  const frame = requestAnimationFrame(start);

  return () => cancelAnimationFrame(frame);
}

function useModalWhileOpen(
  dialog: RefObject<View | null>,
  behind: RefObject<View | null>,
  isOpen: boolean,
) {
  useEffect(() => {
    if (Platform.OS !== "web" || !isOpen) return;

    const previous = document.activeElement;
    const behindNode = behind.current;

    if (behindNode instanceof HTMLElement) behindNode.toggleAttribute("inert", true);
    dialog.current?.focus();

    return () => {
      if (behindNode instanceof HTMLElement) behindNode.toggleAttribute("inert", false);

      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [dialog, behind, isOpen]);
}

export function StackedWindow({
  mode,
  behindRef,
  progress,
  style,
  screenProps,
}: {
  mode: PaletteMode | undefined;
  behindRef: RefObject<View | null>;
  progress: SharedValue<number>;
  style: ComponentProps<typeof Animated.View>["style"];
  screenProps: ScreenProps;
}) {
  const [shown, setShown] = useState(mode && { mode, key: 0 });

  if (mode && mode !== shown?.mode) setShown({ mode, key: (shown?.key ?? 0) + 1 });

  useEffect(
    () =>
      onNextFrame(() =>
        progress.set(
          withSpring(mode ? 1 : 0, mode ? OPEN_SPRING : CLOSE_SPRING, (finished) => {
            if (finished && !mode) scheduleOnRN(setShown, undefined);
          }),
        ),
      ),
    [mode, progress],
  );

  const isOpen = !!mode;
  const dialogRef = useRef<View>(null);

  useModalWhileOpen(dialogRef, behindRef, isOpen);

  const scaleUp = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [0, 1], "clamp"),
    transform: [{ scale: STACK_SCALE + (1 - STACK_SCALE) * progress.get() }],
  }));

  if (!shown) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        role="dialog"
        aria-label="Command palette"
        aria-modal={true}
        pointerEvents={isOpen ? "auto" : "none"}
        style={[style, scaleUp]}
      >
        <View key={shown.key} ref={dialogRef} tabIndex={-1} className="flex-1 outline-none">
          <KeyboardLayer>{getScreen(shown.mode).render(screenProps)}</KeyboardLayer>
        </View>
      </Animated.View>
    </View>
  );
}
