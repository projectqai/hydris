import { LinearGradient } from "expo-linear-gradient";
import type { ComponentType, ReactElement } from "react";
import { createElement } from "react";
import type { LayoutChangeEvent, NativeScrollEvent } from "react-native";
import { Easing, StyleSheet, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
  createAnimatedComponent,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import type { ScrollEdge, ScrollEdgeVisibility } from "./lib/scroll-edge";
import { edgeOpacity } from "./lib/scroll-edge";
import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";

type ScrollShadowSize = "sm" | "default" | "lg";

type ScrollableProps = {
  horizontal?: boolean | null;
  scrollEventThrottle?: number;
  // the scroll handler runs on the UI thread, so the child's own handler gets the native event only
  onScroll?(event: { nativeEvent: NativeScrollEvent }): void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onContentSizeChange?: (width: number, height: number) => void;
};

type Scrollable = ComponentType<ScrollableProps>;

type Axis = "vertical" | "horizontal";

const SIZE_STYLES: Record<ScrollShadowSize, Record<Axis, string>> = {
  sm: { vertical: "h-6", horizontal: "w-6" },
  default: { vertical: "h-8", horizontal: "w-8" },
  lg: { vertical: "h-12", horizontal: "w-12" },
};

// a quarter of each size, so an edge is fully shown after a short scroll
const FADE_DISTANCE: Record<ScrollShadowSize, number> = { sm: 6, default: 8, lg: 12 };

const EDGE_STYLES = StyleSheet.create({
  verticalStart: { position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none" },
  verticalEnd: { position: "absolute", bottom: 0, left: 0, right: 0, pointerEvents: "none" },
  horizontalStart: { position: "absolute", top: 0, bottom: 0, left: 0, pointerEvents: "none" },
  horizontalEnd: { position: "absolute", top: 0, bottom: 0, right: 0, pointerEvents: "none" },
});

const GRADIENT_START = { x: 0, y: 0 };

const GRADIENT_END = {
  vertical: { x: 0, y: 1 },
  horizontal: { x: 1, y: 0 },
};

const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);

// enough stops that the eased curve shows no banding
const FADE_STEPS = 13;

const FADE_LOCATIONS: readonly [number, number, ...number[]] = [
  0,
  1 / FADE_STEPS,
  ...Array.from({ length: FADE_STEPS - 1 }, (_, step) => (step + 2) / FADE_STEPS),
];

// the theme's surface colors are rgb(), and fading to plain transparent would pass through grey
function withAlpha(rgb: string, alpha: number) {
  return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

function fadeColors(color: string): readonly [string, string, ...string[]] {
  const fadeAt = (location: number) => withAlpha(color, 1 - EASE_IN_OUT(location));
  const [first, second, ...rest] = FADE_LOCATIONS;

  return [fadeAt(first), fadeAt(second), ...rest.map(fadeAt)];
}

const SCROLL_EVENT_THROTTLE = 16;

const ANIMATED_SCROLLABLES = new WeakMap<Scrollable, Scrollable>();

function animatedScrollable(scrollable: Scrollable): Scrollable {
  const cached = ANIMATED_SCROLLABLES.get(scrollable);

  if (cached) return cached;

  const animated = createAnimatedComponent(scrollable);
  ANIMATED_SCROLLABLES.set(scrollable, animated);

  return animated;
}

type ScrollMetricValues = {
  offset: SharedValue<number>;
  viewport: SharedValue<number>;
  content: SharedValue<number>;
};

function ScrollShadowEdge({
  edge,
  axis,
  visibility,
  size,
  metrics,
}: {
  edge: ScrollEdge;
  axis: Axis;
  visibility: ScrollEdgeVisibility;
  size: ScrollShadowSize;
  metrics: ScrollMetricValues;
}) {
  const t = useThemeColors();
  const { offset, viewport, content } = metrics;
  const fadeDistance = FADE_DISTANCE[size];

  const fade = useAnimatedStyle(() => {
    const scroll = { offset: offset.get(), viewport: viewport.get(), content: content.get() };

    return { opacity: edgeOpacity(edge, visibility, scroll, fadeDistance) };
  });

  const isStart = edge === "start";
  const position = EDGE_STYLES[`${axis}${isStart ? "Start" : "End"}`];

  return (
    <Animated.View style={[position, fade]}>
      <LinearGradient
        colors={fadeColors(t.card)}
        locations={FADE_LOCATIONS}
        start={isStart ? GRADIENT_START : GRADIENT_END[axis]}
        end={isStart ? GRADIENT_END[axis] : GRADIENT_START}
        className={cn("grow", SIZE_STYLES[size][axis])}
      />
    </Animated.View>
  );
}

export function ScrollShadow({
  visibility = "auto",
  size = "default",
  disabled = false,
  className,
  children,
}: {
  visibility?: ScrollEdgeVisibility;
  size?: ScrollShadowSize;
  disabled?: boolean;
  className?: string;
  children: ReactElement<ScrollableProps, Scrollable>;
}) {
  const offset = useSharedValue(0);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const { props } = children;
  const horizontal = !!props.horizontal;
  const axis: Axis = horizontal ? "horizontal" : "vertical";
  const callerOnScroll = props.onScroll;

  const onScroll = useAnimatedScrollHandler(
    (event) => {
      offset.set(horizontal ? event.contentOffset.x : event.contentOffset.y);

      if (callerOnScroll) scheduleOnRN(callerOnScroll, { nativeEvent: event });
    },
    [horizontal, callerOnScroll],
  );

  if (disabled) return children;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    viewport.set(horizontal ? width : height);
    props.onLayout?.(event);
  };

  const onContentSizeChange = (width: number, height: number) => {
    content.set(horizontal ? width : height);
    props.onContentSizeChange?.(width, height);
  };

  const metrics = { offset, viewport, content };

  return (
    <View className={className}>
      {createElement(animatedScrollable(children.type), {
        ...props,
        key: children.key,
        scrollEventThrottle: props.scrollEventThrottle ?? SCROLL_EVENT_THROTTLE,
        onScroll,
        onLayout,
        onContentSizeChange,
      })}
      <ScrollShadowEdge
        edge="start"
        axis={axis}
        visibility={visibility}
        size={size}
        metrics={metrics}
      />
      <ScrollShadowEdge
        edge="end"
        axis={axis}
        visibility={visibility}
        size={size}
        metrics={metrics}
      />
    </View>
  );
}
