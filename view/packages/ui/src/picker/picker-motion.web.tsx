import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";

import { PulseLayer, ShakeFrame } from "../hold-motion";
import { cn } from "../lib/utils";
import { usePressOutside } from "../press-outside";
import type { HighlightLook, MotionItemProps, MotionRootProps } from "./picker-motion";

export const OPENS_IN_MODAL = false;

const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

const OPEN_HEIGHT = cn("transition-[height] duration-[320ms] motion-reduce:transition-none", EASE);

const FOLD_HEIGHT = cn(
  "transition-[height] delay-[70ms] duration-300 motion-reduce:transition-none",
  EASE,
);

const SHOW_FADE = "transition-opacity duration-[220ms] ease-out motion-reduce:transition-none";

const HIDE_FADE = "transition-opacity duration-[160ms] ease-out motion-reduce:transition-none";

const COLOR_FADE = "transition-opacity duration-[220ms] ease-out motion-reduce:transition-none";

const HIGHLIGHT_TRANSITION = cn(
  "transition-[transform,height] duration-300 motion-reduce:transition-none",
  EASE,
);

const COVER_TRANSITION = cn(
  "transition-[clip-path] duration-300 motion-reduce:transition-none",
  EASE,
);

const STAGGER_DELAYS = [
  "delay-[70ms]",
  "delay-[105ms]",
  "delay-[140ms]",
  "delay-[175ms]",
  "delay-[210ms]",
  "delay-[245ms]",
];

const ROW_GAP = 2;

const TINT_OPACITY: Record<HighlightLook, number> = { confirming: 1, pending: 0 };

type RowMetrics = { index: number; height?: number };

// CSS cannot transition from an automatic height, so a fold or unfold pins the measured heights for
// one frame, runs the transition, then returns the rows to their automatic height
type FoldPhase = "rest" | "pin" | "run";

const FOLD_MS = 400;

type RowsContextValue = {
  rows: Record<string, RowMetrics>;
  expanded: boolean;
  phase: FoldPhase;
  currentIndex: number | undefined;
  furthest: number;
  register: (value: string, index: number) => void;
  unregister: (value: string) => void;
  measure: (value: string, height: number) => void;
};

const RowsContext = createContext<RowsContextValue | null>(null);

function useRows() {
  const context = use(RowsContext);

  if (!context) throw new Error("MotionItem must be rendered inside a MotionRoot");

  return context;
}

export function MotionRoot({
  className,
  current,
  expanded,
  highlight,
  onPressOutside,
  children,
}: MotionRootProps) {
  const frame = useRef<View>(null);
  const [rows, setRows] = useState<Record<string, RowMetrics>>({});

  usePressOutside(frame, onPressOutside);

  const register = useCallback((value: string, index: number) => {
    setRows((prev) =>
      prev[value]?.index === index ? prev : { ...prev, [value]: { ...prev[value], index } },
    );
  }, []);

  const unregister = useCallback((value: string) => {
    setRows((prev) => {
      const next = { ...prev };
      delete next[value];

      return next;
    });
  }, []);

  const measure = useCallback((value: string, height: number) => {
    setRows((prev) => {
      const row = prev[value];

      if (!row || row.height === height) return prev;

      return { ...prev, [value]: { ...row, height } };
    });
  }, []);

  const [phase, setPhase] = useState<FoldPhase>("rest");
  const [lastExpanded, setLastExpanded] = useState(expanded);

  if (expanded !== lastExpanded) {
    setLastExpanded(expanded);
    setPhase(phase === "rest" ? "pin" : "run");
  }

  useEffect(() => {
    if (phase === "pin") {
      const frame = requestAnimationFrame(() => setPhase("run"));

      return () => cancelAnimationFrame(frame);
    }

    if (phase === "run") {
      const timer = setTimeout(() => setPhase("rest"), FOLD_MS);

      return () => clearTimeout(timer);
    }
  }, [phase]);

  const currentIndex = current === undefined ? undefined : rows[current]?.index;

  const furthest = Math.max(
    0,
    ...Object.values(rows).map((row) => Math.abs(row.index - (currentIndex ?? 0))),
  );

  const context = useMemo(
    () => ({ rows, expanded, phase, currentIndex, furthest, register, unregister, measure }),
    [rows, expanded, phase, currentIndex, furthest, register, unregister, measure],
  );

  return (
    <RowsContext value={context}>
      <View ref={frame} className={className}>
        <View className="relative">
          {highlight && expanded && (
            <Highlight
              rows={rows}
              expanded={expanded}
              currentIndex={currentIndex}
              value={highlight.value}
              look={highlight.look}
              covered={highlight.cover !== undefined}
            />
          )}
          {children}
          {highlight?.cover && expanded && (
            <Cover
              rows={rows}
              expanded={expanded}
              currentIndex={currentIndex}
              value={highlight.value}
            >
              {highlight.cover}
            </Cover>
          )}
        </View>
      </View>
    </RowsContext>
  );
}

function placeHighlight(
  rows: Record<string, RowMetrics>,
  target: RowMetrics | undefined,
  shownAt: (index: number) => boolean,
) {
  if (target?.height === undefined || !shownAt(target.index)) return undefined;

  const gap = target.index > 0 && shownAt(target.index - 1) ? ROW_GAP : 0;
  let offset = gap;

  for (const row of Object.values(rows)) {
    if (row.index >= target.index || !shownAt(row.index)) continue;

    if (row.height === undefined) return undefined;

    offset += row.height;
  }

  return { offset, height: target.height - gap };
}

// A tint left under the cover shows through the cover's rounded edge.
function Highlight({
  rows,
  expanded,
  currentIndex,
  value,
  look,
  covered,
}: {
  rows: Record<string, RowMetrics>;
  expanded: boolean;
  currentIndex: number | undefined;
  value: string;
  look: HighlightLook;
  covered: boolean;
}) {
  const place = placeHighlight(rows, rows[value], (index) => expanded || index === currentIndex);

  if (!place) return null;

  return (
    <View
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0",
        HIGHLIGHT_TRANSITION,
        covered && "invisible",
      )}
      style={{ height: place.height, transform: [{ translateY: place.offset }] }}
    >
      <View
        className={cn("bg-foreground absolute inset-0 rounded-[11px]", COLOR_FADE)}
        style={{ opacity: TINT_OPACITY[look] }}
      />
      <PulseLayer
        key={look}
        look={look === "pending" ? "running" : "confirming"}
        className="rounded-[11px]"
      />
    </View>
  );
}

function Cover({
  rows,
  expanded,
  currentIndex,
  value,
  children,
}: {
  rows: Record<string, RowMetrics>;
  expanded: boolean;
  currentIndex: number | undefined;
  value: string;
  children: ReactNode;
}) {
  const layer = useRef<View>(null);
  const tint = useRef<View>(null);
  const place = placeHighlight(rows, rows[value], (index) => expanded || index === currentIndex);
  const top = place?.offset;
  const bottom = place === undefined ? undefined : place.offset + place.height;

  // React Native styles have no clipPath, so it goes on the DOM element.
  useLayoutEffect(() => {
    const element = layer.current;
    const tintElement = tint.current;

    if (top === undefined || bottom === undefined) return;

    if (!(element instanceof HTMLElement) || !(tintElement instanceof HTMLElement)) return;

    element.style.clipPath = coverClip(top, bottom, 0);

    // The tint stays 1px inside the rounded edge. At the edge it shows through the fill's anti-aliasing.
    tintElement.style.clipPath = coverClip(top, bottom, 1);
  }, [top, bottom]);

  if (!place) return null;

  return (
    <View
      ref={layer}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", COVER_TRANSITION)}
    >
      <View ref={tint} className={cn("bg-foreground absolute inset-0", COVER_TRANSITION)} />
      <PulseLayer look="confirming" />
      <View className="absolute inset-x-0" style={{ top: place.offset, height: place.height }}>
        {children}
      </View>
    </View>
  );
}

function coverClip(top: number, bottom: number, inset: number) {
  const sides = `${top + inset}px ${inset}px calc(100% - ${bottom - inset}px) ${inset}px`;

  return `inset(${sides} round ${11 - inset}px)`;
}

function rowHeight(phase: FoldPhase, shown: boolean, measured: number | undefined) {
  if (!shown) return 0;

  return phase === "rest" ? undefined : measured;
}

export function MotionItem({ value, index, current, shakes, children }: MotionItemProps) {
  const { rows, expanded, phase, currentIndex, furthest, register, unregister, measure } =
    useRows();

  useLayoutEffect(() => register(value, index), [register, value, index]);

  useLayoutEffect(() => () => unregister(value), [unregister, value]);

  const shown = expanded || current;
  const wasShown = !expanded || current;
  const distance = Math.abs(index - (currentIndex ?? 0));
  const step = expanded ? distance : furthest - distance;
  const delay = STAGGER_DELAYS[Math.min(step, STAGGER_DELAYS.length - 1)];
  const height = rowHeight(phase, phase === "pin" ? wasShown : shown, rows[value]?.height);

  // Clip, because a hidden frame scrolls to a row focused mid-unfold and that cancels the press.
  // overflow-hidden is the fallback for WebKit without clip.
  return (
    <ShakeFrame shakes={shakes}>
      <View
        className={cn(
          "[overflow:clip] overflow-hidden",
          phase === "run" && (expanded ? OPEN_HEIGHT : FOLD_HEIGHT),
          !shown && "pointer-events-none",
        )}
        style={{ height }}
      >
        <View
          className={shown ? cn(SHOW_FADE, delay) : HIDE_FADE}
          style={{ opacity: shown ? 1 : 0 }}
          onLayout={(event) => measure(value, event.nativeEvent.layout.height)}
        >
          <View className={cn(expanded && index > 0 && "pt-0.5")}>{children}</View>
        </View>
      </View>
    </ShakeFrame>
  );
}
