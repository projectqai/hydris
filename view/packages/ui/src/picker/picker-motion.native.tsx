import type { ReactNode } from "react";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { PulseLayer, ShakeFrame } from "../hold-motion";
import { useNativeModalBox, usePhoneModalFrame } from "../hooks/use-phone-modal-frame";
import { SETTLED_SPRING } from "../lib/spring";
import { useThemeColors } from "../lib/theme";
import type { HighlightLook, MotionItemProps, MotionRootProps } from "./picker-motion";

export const OPENS_IN_MODAL = true;

const SPRING = { ...SETTLED_SPRING, reduceMotion: ReduceMotion.System };

const LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(SETTLED_SPRING.damping)
  .stiffness(SETTLED_SPRING.stiffness)
  .mass(SETTLED_SPRING.mass)
  .reduceMotion(ReduceMotion.System);

const COLOR_FADE = {
  duration: 220,
  easing: Easing.out(Easing.ease),
  reduceMotion: ReduceMotion.System,
};

const SHEET_BORDERS = 2;

const CARD_FADE_PROGRESS = [0, 0.1];
const ROWS_FADE_PROGRESS = [0.05, 0.25];

const SHEET_OPEN = {
  duration: 500,
  easing: Easing.bezier(0.2, 0, 0, 1),
  reduceMotion: ReduceMotion.System,
};

const SHEET_CLOSE = {
  duration: 180,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};

const STYLES = StyleSheet.create({
  highlight: { position: "absolute", left: 0, right: 0, top: 0, pointerEvents: "none" },
  cover: { overflow: "hidden", borderRadius: 11 },
  covered: { opacity: 0 },
  coverContent: { position: "absolute", left: 0, right: 0, top: 0 },
});

type Layout = { y: number; height: number };

type Rect = { x: number; y: number; width: number; height: number };

type ListContextValue = { folded: boolean; report: (value: string, layout: Layout) => void };

const ListContext = createContext<ListContextValue | null>(null);

function useList() {
  const context = use(ListContext);

  if (!context) throw new Error("MotionItem must be rendered inside a MotionRoot");

  return context;
}

export function MotionRoot({
  className,
  current,
  expanded,
  highlight,
  onPressOutside,
  onEscape,
  children,
}: MotionRootProps) {
  const anchor = useRef<View>(null);
  const [origin, setOrigin] = useState<Rect | null>(null);
  const sheet = expanded && current !== undefined;
  const closed = useCallback(() => setOrigin(null), []);

  useEffect(() => {
    if (!sheet) return;

    anchor.current?.measureInWindow((x, y, width, height) => setOrigin({ x, y, width, height }));
  }, [sheet]);

  return (
    <>
      <View ref={anchor} collapsable={false} className={className}>
        <RowList folded={current !== undefined} highlight={highlight}>
          {children}
        </RowList>
      </View>
      {origin && current !== undefined && (
        <Sheet
          origin={origin}
          current={current}
          highlight={highlight}
          open={sheet}
          onClosed={closed}
          onPressOutside={onPressOutside}
          onEscape={onEscape}
        >
          {children}
        </Sheet>
      )}
    </>
  );
}

function Sheet({
  origin,
  current,
  highlight,
  open,
  onClosed,
  onPressOutside,
  onEscape,
  children,
}: {
  origin: Rect;
  current: string;
  highlight: MotionRootProps["highlight"];
  open: boolean;
  onClosed: () => void;
  onPressOutside: (() => void) | undefined;
  onEscape: () => void;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const screen = useWindowDimensions();
  const progress = useSharedValue(0);
  const shown = useSharedValue(1);
  const [listHeight, setListHeight] = useState<number>();
  const [currentY, setCurrentY] = useState<number>();
  const [pinnedY, setPinnedY] = useState<number>();
  const measured = listHeight !== undefined && currentY !== undefined;
  const phoneFrame = usePhoneModalFrame();
  const nativeBox = useNativeModalBox();
  const edge = phoneFrame?.edge ?? (screen.height - nativeBox.height) / 2;
  const top = (StatusBar.currentHeight ?? 0) + edge;
  const bottom = screen.height - edge;
  const width = phoneFrame?.width ?? nativeBox.width;
  const left = (screen.width - width) / 2;
  const fullHeight = Math.min((listHeight ?? 0) + SHEET_BORDERS, bottom - top);
  const centredY = Math.min(Math.max((screen.height - fullHeight) / 2, top), bottom - fullHeight);

  if (open && measured && pinnedY === undefined) setPinnedY(centredY);

  const y = pinnedY ?? centredY;
  const height = Math.min(fullHeight, bottom - y);
  const foldedScale = origin.width / width;
  const foldedShift = -foldedScale * (currentY ?? 0);

  const placeCurrent = useCallback(
    (value: string, layout: Layout) => {
      if (value === current) setCurrentY(layout.y);
    },
    [current],
  );

  useEffect(() => {
    if (open && !measured) return;

    if (open) {
      shown.set(1);
      progress.set(withTiming(1, SHEET_OPEN));

      return;
    }

    if (!measured) {
      onClosed();

      return;
    }

    shown.set(
      withTiming(0, SHEET_CLOSE, (finished) => {
        if (finished) scheduleOnRN(onClosed);
      }),
    );
  }, [open, measured, progress, shown, onClosed]);

  const card = useAnimatedStyle(() => ({
    opacity:
      shown.get() * interpolate(progress.get(), CARD_FADE_PROGRESS, [0, 1], Extrapolation.CLAMP),
    left: interpolate(progress.get(), [0, 1], [origin.x, left]),
    top: interpolate(progress.get(), [0, 1], [origin.y, y]),
    width: interpolate(progress.get(), [0, 1], [origin.width, width]),
    height: interpolate(progress.get(), [0, 1], [origin.height, height]),
  }));

  const list = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), ROWS_FADE_PROGRESS, [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.get(), [0, 1], [foldedShift, 0]) },
      { scale: interpolate(progress.get(), [0, 1], [foldedScale, 1]) },
    ],
  }));

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.get() * progress.get() }));

  return (
    <Modal visible transparent animationType="none" onRequestClose={onEscape} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.backdrop }, backdrop]}>
        <Pressable
          onPress={onPressOutside}
          disabled={!onPressOutside}
          accessibilityLabel="Close"
          className="absolute inset-0"
        />
      </Animated.View>
      <Animated.View
        needsOffscreenAlphaCompositing
        renderToHardwareTextureAndroid
        style={[{ position: "absolute" }, card]}
      >
        <View className="border-border bg-card flex-1 overflow-hidden rounded-2xl border">
          <Animated.View
            style={[
              {
                position: "absolute",
                width: width - SHEET_BORDERS,
                height: height - SHEET_BORDERS,
                transformOrigin: "top left",
              },
              list,
            ]}
          >
            <ScrollView>
              <View
                className="p-1"
                onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
              >
                <RowList folded={false} highlight={highlight} onReport={placeCurrent}>
                  {children}
                </RowList>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

function RowList({
  folded,
  highlight,
  onReport,
  children,
}: {
  folded: boolean;
  highlight: MotionRootProps["highlight"];
  onReport?: (value: string, layout: Layout) => void;
  children: ReactNode;
}) {
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});

  const report = useCallback(
    (value: string, layout: Layout) => {
      onReport?.(value, layout);
      setLayouts((prev) => {
        const known = prev[value];

        if (known?.y === layout.y && known.height === layout.height) return prev;

        return { ...prev, [value]: layout };
      });
    },
    [onReport],
  );

  const context = useMemo(() => ({ folded, report }), [folded, report]);
  const target = highlight && layouts[highlight.value];

  return (
    <ListContext value={context}>
      <View className="gap-0.5">
        {highlight && target && (
          <Highlight
            layout={target}
            look={highlight.look}
            covered={highlight.cover !== undefined}
          />
        )}
        {children}
        {highlight?.cover && target && <Cover layout={target}>{highlight.cover}</Cover>}
      </View>
    </ListContext>
  );
}

function useHighlightFrame(layout: Layout) {
  const y = useSharedValue(layout.y);
  const height = useSharedValue(layout.height);

  useEffect(() => {
    y.set(withSpring(layout.y, SPRING));
    height.set(withSpring(layout.height, SPRING));
  }, [layout, y, height]);

  const frame = useAnimatedStyle(() => ({
    height: height.get(),
    transform: [{ translateY: y.get() }],
  }));

  return { y, frame };
}

// A tint left under the cover shows through the cover's rounded edge.
function Highlight({
  layout,
  look,
  covered,
}: {
  layout: Layout;
  look: HighlightLook;
  covered: boolean;
}) {
  const { frame } = useHighlightFrame(layout);
  const inverted = useSharedValue(look === "confirming" ? 1 : 0);

  useEffect(() => {
    inverted.set(withTiming(look === "confirming" ? 1 : 0, COLOR_FADE));
  }, [look, inverted]);

  const invertedStyle = useAnimatedStyle(() => ({ opacity: inverted.get() }));

  return (
    <Animated.View style={[STYLES.highlight, frame, covered && STYLES.covered]}>
      <Animated.View style={[StyleSheet.absoluteFill, invertedStyle]}>
        <View className="bg-foreground flex-1 rounded-[11px]" />
      </Animated.View>
      <PulseLayer
        key={look}
        look={look === "pending" ? "running" : "confirming"}
        className="rounded-[11px]"
      />
    </Animated.View>
  );
}

// The content moves opposite to the frame, so it stays on the row.
// The tint stays 1px inside the rounded edge. At the edge it shows through the fill's anti-aliasing.
function Cover({ layout, children }: { layout: Layout; children: ReactNode }) {
  const { y, frame } = useHighlightFrame(layout);
  const goal = useSharedValue(layout.y);

  useEffect(() => {
    goal.set(layout.y);
  }, [layout, goal]);

  const content = useAnimatedStyle(() => ({ transform: [{ translateY: goal.get() - y.get() }] }));

  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      style={[STYLES.highlight, STYLES.cover, frame]}
    >
      <View className="bg-foreground absolute inset-px rounded-[10px]" />
      <PulseLayer look="confirming" />
      <Animated.View style={[STYLES.coverContent, { height: layout.height }, content]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

export function MotionItem({ value, current, shakes, children }: MotionItemProps) {
  const { folded, report } = useList();

  if (folded && !current) return null;

  return (
    <Animated.View
      layout={LAYOUT_TRANSITION}
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        report(value, { y, height });
      }}
    >
      <ShakeFrame shakes={shakes}>{children}</ShakeFrame>
    </Animated.View>
  );
}
