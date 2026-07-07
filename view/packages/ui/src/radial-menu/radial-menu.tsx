"use no memo";

import { Image } from "expo-image";
import { useColorScheme } from "nativewind";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { useThemeColors } from "../lib/theme";
import { useIsScreenLocked } from "../screen-lock";
import { hitSlice, polar, sliceCenterAngle, slicePath } from "./geometry";
import type { RadialMenuItem, RadialMenuItemVariant, RadialMenuProps } from "./types";

const DEFAULT_RADIUS = 145;
const INNER_RATIO = 0.42;
const ICON_SIZE = 22;
const SLICE_GAP_PX = 4;
const SLICE_CORNER_R = 6;

type VariantStyle = {
  fill: string;
  fillHover: string;
  stroke: string;
  strokeHover: string;
  label?: { idle: string; hover: string };
};

type Palette = {
  surface: string;
  surfaceCenter: string;
  centerBorder: string;
  variants: Record<RadialMenuItemVariant, VariantStyle>;
};

const DARK_SURFACE = "rgba(28, 28, 30, 0.72)";
const LIGHT_SURFACE = "rgba(248, 248, 250, 0.72)";

const DARK_PALETTE: Palette = {
  surface: DARK_SURFACE,
  surfaceCenter: "rgba(28, 28, 30, 0.88)",
  centerBorder: "rgba(255, 255, 255, 0.30)",
  variants: {
    default: {
      fill: DARK_SURFACE,
      fillHover: "rgba(58, 58, 62, 0.88)",
      stroke: "rgba(255, 255, 255, 0.22)",
      strokeHover: "rgba(255, 255, 255, 0.48)",
    },
    destructive: {
      fill: DARK_SURFACE,
      fillHover: "rgba(205, 24, 24, 0.48)",
      stroke: "rgba(248, 113, 113, 0.45)",
      strokeHover: "rgba(248, 113, 113, 0.85)",
      label: { idle: "rgba(248, 113, 113, 0.85)", hover: "rgb(255, 255, 255)" },
    },
    success: {
      fill: DARK_SURFACE,
      fillHover: "rgba(34, 197, 94, 0.42)",
      stroke: "rgba(74, 222, 128, 0.45)",
      strokeHover: "rgba(74, 222, 128, 0.85)",
      label: { idle: "rgba(134, 239, 172, 0.85)", hover: "rgb(255, 255, 255)" },
    },
  },
};

const LIGHT_PALETTE: Palette = {
  surface: LIGHT_SURFACE,
  surfaceCenter: "rgba(248, 248, 250, 0.88)",
  centerBorder: "rgba(0, 0, 0, 0.18)",
  variants: {
    default: {
      fill: LIGHT_SURFACE,
      fillHover: "rgba(200, 200, 210, 0.92)",
      stroke: "rgba(0, 0, 0, 0.18)",
      strokeHover: "rgba(0, 0, 0, 0.42)",
    },
    destructive: {
      fill: LIGHT_SURFACE,
      fillHover: "rgba(190, 18, 18, 0.48)",
      stroke: "rgba(190, 18, 18, 0.50)",
      strokeHover: "rgba(190, 18, 18, 0.95)",
      label: { idle: "rgb(170, 14, 14)", hover: "rgb(255, 255, 255)" },
    },
    success: {
      fill: LIGHT_SURFACE,
      fillHover: "rgba(40, 180, 99, 0.42)",
      stroke: "rgba(40, 180, 99, 0.50)",
      strokeHover: "rgba(40, 180, 99, 0.95)",
      label: { idle: "rgb(40, 140, 70)", hover: "rgb(255, 255, 255)" },
    },
  },
};

function pickTypography(count: number) {
  if (count <= 3) return { fontSize: 15, lineHeight: 18, maxCharsPerWord: 13 };
  if (count <= 5) return { fontSize: 14, lineHeight: 17, maxCharsPerWord: 10 };
  return { fontSize: 12, lineHeight: 15, maxCharsPerWord: 9 };
}

function fitWord(word: string, maxLen: number): string {
  if (word.length <= maxLen) return word;
  if (word.length <= maxLen * 2) {
    const mid = Math.ceil(word.length / 2);
    return `${word.slice(0, mid)}-\n${word.slice(mid)}`;
  }
  return word.slice(0, maxLen - 1) + "…";
}

function fitLabel(label: string, maxCharsPerWord: number): string {
  return label
    .split(" ")
    .map((w) => fitWord(w, maxCharsPerWord))
    .join(" ");
}

function labelLayout(
  index: number,
  count: number,
  radius: number,
  innerR: number,
  labelR: number,
  lineHeight: number,
) {
  const height = lineHeight * 2;
  const angle = sliceCenterAngle(index, count);
  const pos = polar(labelR, angle);
  const innerEdgeR = Math.max(innerR + 4, labelR - height / 2);
  const halfAngle = Math.PI / count - SLICE_GAP_PX / 2 / innerEdgeR;
  const chord = 2 * innerEdgeR * Math.sin(halfAngle);
  const width = Math.min(chord * 0.78, radius * 0.7);
  return {
    left: radius + pos.x - width / 2,
    top: radius + pos.y - height / 2,
    width,
    height,
  };
}

function TitleIcon({ uri }: { uri: string }) {
  return (
    <Image
      source={{ uri }}
      style={{ width: ICON_SIZE, height: ICON_SIZE, marginBottom: 4 }}
      accessibilityLabel="Entity symbol"
    />
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const IS_WEB = Platform.OS === "web";

function sliceColors(variant: VariantStyle, on: boolean) {
  "worklet";
  return {
    fill: on ? variant.fillHover : variant.fill,
    stroke: on ? variant.strokeHover : variant.stroke,
  };
}

function labelColor(
  item: RadialMenuItem,
  variant: VariantStyle,
  on: boolean,
  fallbackColor: string,
  disabledColor: string,
) {
  "worklet";
  if (item.disabled) return disabledColor;
  if (!variant.label) return fallbackColor;
  return on ? variant.label.hover : variant.label.idle;
}

// Native animates fill off the JS thread; web can't reanimate svg fill, so it re-renders.
function NativeSlicePath({
  d,
  index,
  highlight,
  variant,
}: {
  d: string;
  index: number;
  highlight: SharedValue<number>;
  variant: VariantStyle;
}) {
  const animatedProps = useAnimatedProps(() => sliceColors(variant, highlight.value === index));
  return (
    <AnimatedPath
      d={d}
      fill={variant.fill}
      stroke={variant.stroke}
      strokeWidth={1.25}
      animatedProps={animatedProps}
    />
  );
}

function WebSlicePath({
  d,
  hovered,
  index,
  variant,
}: {
  d: string;
  hovered: number;
  index: number;
  variant: VariantStyle;
}) {
  const { fill, stroke } = sliceColors(variant, hovered === index);
  return <Path d={d} fill={fill} stroke={stroke} strokeWidth={1.25} />;
}

type SliceLabelProps = {
  item: RadialMenuItem;
  index: number;
  variant: VariantStyle;
  layout: ReturnType<typeof labelLayout>;
  typo: ReturnType<typeof pickTypography>;
  fallbackColor: string;
  disabledColor: string;
};

// Animated.Text drops className on web, so web uses a plain Text.
function NativeSliceLabel({
  item,
  index,
  highlight,
  variant,
  layout,
  typo,
  fallbackColor,
  disabledColor,
}: SliceLabelProps & { highlight: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    color: labelColor(item, variant, highlight.value === index, fallbackColor, disabledColor),
  }));
  return (
    <View pointerEvents="none" className="absolute items-center justify-center" style={layout}>
      <Animated.Text
        numberOfLines={2}
        ellipsizeMode="tail"
        className="font-sans-semibold text-center"
        style={[
          { fontSize: typo.fontSize, lineHeight: typo.lineHeight, letterSpacing: 0.1 },
          animatedStyle,
        ]}
      >
        {fitLabel(item.label, typo.maxCharsPerWord)}
      </Animated.Text>
    </View>
  );
}

function WebSliceLabel({
  item,
  index,
  hovered,
  variant,
  layout,
  typo,
  fallbackColor,
  disabledColor,
}: SliceLabelProps & { hovered: number }) {
  const color = labelColor(item, variant, hovered === index, fallbackColor, disabledColor);
  return (
    <View pointerEvents="none" className="absolute items-center justify-center" style={layout}>
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        className="font-sans-semibold text-center"
        style={{
          color,
          fontSize: typo.fontSize,
          lineHeight: typo.lineHeight,
          letterSpacing: 0.1,
        }}
      >
        {fitLabel(item.label, typo.maxCharsPerWord)}
      </Text>
    </View>
  );
}

export function RadialMenu({
  position,
  items,
  onSelect,
  onClose,
  title,
  titleIconUri,
  radius = DEFAULT_RADIUS,
}: RadialMenuProps) {
  const t = useThemeColors();
  const { colorScheme } = useColorScheme();
  const palette = colorScheme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
  const window = useWindowDimensions();
  const highlight = useSharedValue<number>(-1);
  const [hovered, setHovered] = useState<number>(-1);

  // Pad with close so a single slice doesn't look like a UI bug.
  const slices = useMemo<readonly RadialMenuItem[]>(
    () => (items.length === 1 ? [...items, { id: "__close__", label: "Close" }] : items),
    [items],
  );

  const count = slices.length;
  const innerR = radius * INNER_RATIO;
  const labelR = (innerR + radius - 1) / 2;
  const typo = pickTypography(count);

  const cx = Math.min(Math.max(position.x, radius + 8), window.width - radius - 8);
  const cy = Math.min(Math.max(position.y, radius + 8), window.height - radius - 8);

  const enterIndex = useCallback(
    (i: number) => {
      const item = slices[i];
      if (!item || item.disabled) return;
      if (item.id === "__close__") onClose();
      else {
        onSelect(item.id);
        onClose();
      }
    },
    [slices, onSelect, onClose],
  );

  // Keyboard tab cycles slices, enter/space invokes, escape closes (web only).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // prevent map's window listener from reopening radial
        e.stopPropagation();
        const i = highlight.value;
        if (i >= 0 && i < count) enterIndex(i);
        else onClose();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const current = highlight.value;
        const next = e.shiftKey
          ? current < 0
            ? count - 1
            : (current - 1 + count) % count
          : current < 0
            ? 0
            : (current + 1) % count;
        highlight.value = next;
        setHovered(next);
        return;
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, enterIndex, count, highlight]);

  const isScreenLocked = useIsScreenLocked();
  // Tap or drag to a slice, release to invoke. minDistance 0 makes taps activate too.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isScreenLocked)
        .minDistance(0)
        .onBegin((e) => {
          "worklet";
          const i = hitSlice(e.x - radius, e.y - radius, count, innerR, radius);
          highlight.value = i;
          if (IS_WEB) scheduleOnRN(setHovered, i);
        })
        .onUpdate((e) => {
          "worklet";
          const i = hitSlice(e.x - radius, e.y - radius, count, innerR, radius);
          if (i !== highlight.value) {
            highlight.value = i;
            if (IS_WEB) scheduleOnRN(setHovered, i);
          }
        })
        .onEnd(() => {
          "worklet";
          const i = highlight.value;
          if (i >= 0 && i < count) scheduleOnRN(enterIndex, i);
          else scheduleOnRN(onClose);
        }),
    [radius, count, innerR, highlight, enterIndex, onClose, isScreenLocked],
  );

  // Mouse hover only in web, touch doesn't have.
  const webHoverProps = useMemo(() => {
    if (Platform.OS !== "web") return {};
    const move = (e: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const i = hitSlice(
        e.clientX - rect.left - radius,
        e.clientY - rect.top - radius,
        count,
        innerR,
        radius,
      );
      highlight.value = i;
      setHovered(i);
    };
    const leave = () => {
      highlight.value = -1;
      setHovered(-1);
    };
    return { onMouseMove: move, onMouseLeave: leave };
  }, [count, innerR, radius, highlight]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close menu"
          accessibilityRole="button"
          className="absolute inset-0 bg-black/15 outline-none dark:bg-black/30"
        />
        <View
          pointerEvents="box-none"
          className="absolute"
          style={{
            left: cx - radius,
            top: cy - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: radius,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 12,
          }}
        >
          <GestureDetector gesture={pan}>
            <View style={{ width: radius * 2, height: radius * 2 }} {...(webHoverProps as object)}>
              <Svg
                width={radius * 2}
                height={radius * 2}
                viewBox={`${-radius} ${-radius} ${radius * 2} ${radius * 2}`}
              >
                <Circle
                  cx={0}
                  cy={0}
                  r={radius - 0.5}
                  fill={colorScheme === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(0, 0, 0, 0.22)"}
                />
                {slices.map((item, i) => {
                  const variant = palette.variants[item.variant ?? "default"];
                  const d = slicePath(i, count, innerR, radius - 1, SLICE_GAP_PX, SLICE_CORNER_R);
                  return IS_WEB ? (
                    <WebSlicePath
                      key={item.id}
                      d={d}
                      hovered={hovered}
                      index={i}
                      variant={variant}
                    />
                  ) : (
                    <NativeSlicePath
                      key={item.id}
                      d={d}
                      index={i}
                      highlight={highlight}
                      variant={variant}
                    />
                  );
                })}
              </Svg>

              {slices.map((item, i) => {
                const variant = palette.variants[item.variant ?? "default"];
                const layout = labelLayout(i, count, radius, innerR, labelR, typo.lineHeight);
                return IS_WEB ? (
                  <WebSliceLabel
                    key={item.id}
                    item={item}
                    index={i}
                    hovered={hovered}
                    variant={variant}
                    layout={layout}
                    typo={typo}
                    fallbackColor={t.foreground}
                    disabledColor={t.controlFgDisabled}
                  />
                ) : (
                  <NativeSliceLabel
                    key={item.id}
                    item={item}
                    index={i}
                    highlight={highlight}
                    variant={variant}
                    layout={layout}
                    typo={typo}
                    fallbackColor={t.foreground}
                    disabledColor={t.controlFgDisabled}
                  />
                );
              })}

              <View
                pointerEvents="none"
                accessibilityLabel="Close menu"
                accessibilityRole="button"
                accessible
                className="absolute items-center justify-center outline-none"
                style={{
                  left: radius - innerR + 5,
                  top: radius - innerR + 5,
                  width: (innerR - 5) * 2,
                  height: (innerR - 5) * 2,
                  borderRadius: innerR,
                  borderWidth: 1.25,
                  borderColor: palette.centerBorder,
                  backgroundColor: palette.surfaceCenter,
                }}
              >
                {titleIconUri && <TitleIcon uri={titleIconUri} />}
                <Text
                  numberOfLines={2}
                  ellipsizeMode="tail"
                  className="font-sans-semibold text-13 text-center"
                  style={{
                    color: t.foreground,
                    lineHeight: 16,
                    paddingHorizontal: 12,
                    letterSpacing: 0.1,
                  }}
                >
                  {title ? fitLabel(title, 14) : ""}
                </Text>
              </View>
            </View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
