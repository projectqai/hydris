"use no memo";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useThemeColors } from "../lib/theme";
import {
  COLLAPSED_PX,
  DIVIDER_SIZE,
  MID_SNAP_POINTS,
  SIZE_COLLAPSE_FADE,
  SIZE_COLLAPSED,
  TIMING_CONFIG,
  Z,
} from "./constants";
import { LayoutEditingContext, SplitDragContext, SplitRatioContext } from "./contexts";
import type { NodePath } from "./types";

export function AnimatedSplit({
  path,
  direction,
  targetRatio,
  first,
  second,
}: {
  path: NodePath;
  direction: "horizontal" | "vertical";
  targetRatio: number;
  first: React.ReactNode;
  second: React.ReactNode;
}) {
  const t = useThemeColors();
  const { isCustomizing, onRatioChange } = useContext(LayoutEditingContext)!;
  const isH = direction === "horizontal";
  const ratio = useSharedValue(targetRatio);
  const dragStartRatio = useSharedValue(0);
  const containerSizeSV = useSharedValue(0);
  const crossAxisSizeSV = useSharedValue(0);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const onDragStateChange = useContext(SplitDragContext);
  const parentSplitCtx = useContext(SplitRatioContext);
  const pathRef = useRef(path);
  pathRef.current = path;
  const notifyRatioChange = useCallback(
    (r: number) => onRatioChange(pathRef.current, r),
    [onRatioChange],
  );

  const isCollapsedRatio = targetRatio < 0.12 || targetRatio > 0.88;
  const restoreRatio = useSharedValue(isCollapsedRatio ? 0.5 : targetRatio);
  const restoreRatioRef = useRef(isCollapsedRatio ? 0.5 : targetRatio);
  if (!isCollapsedRatio) {
    restoreRatioRef.current = targetRatio;
  }

  const measured = isH ? dims.width : dims.height;

  const collapsedRatio = useDerivedValue(() => {
    const cs = containerSizeSV.value;
    if (cs <= DIVIDER_SIZE) return COLLAPSED_PX / 1000;
    return Math.min(COLLAPSED_PX / (cs - DIVIDER_SIZE), 0.1);
  });

  useEffect(() => {
    containerSizeSV.value = measured;
    crossAxisSizeSV.value = isH ? dims.height : dims.width;
  }, [measured, dims]);

  useEffect(() => {
    ratio.value = withTiming(targetRatio, TIMING_CONFIG);
    if (!isCollapsedRatio) {
      restoreRatio.value = targetRatio;
    }
  }, [targetRatio]);

  const firstSize = useDerivedValue(() => (containerSizeSV.value - DIVIDER_SIZE) * ratio.value);
  const secondSize = useDerivedValue(() => containerSizeSV.value - firstSize.value - DIVIDER_SIZE);

  const tapGesture = Gesture.Tap()
    .hitSlop(isH ? { left: 12, right: 12 } : { top: 12, bottom: 12 })
    .onEnd(() => {
      "worklet";
      const cr = collapsedRatio.value;
      if (ratio.value <= cr + 0.01 || ratio.value >= 1 - cr - 0.01) {
        const restore = restoreRatio.value;
        ratio.value = withTiming(restore, { duration: 200 });
        runOnJS(notifyRatioChange)(restore);
      }
    });

  const panGesture = Gesture.Pan()
    .hitSlop(isH ? { left: 12, right: 12 } : { top: 12, bottom: 12 })
    .minDistance(3)
    .onStart(() => {
      dragStartRatio.value = ratio.value;
      if (onDragStateChange) runOnJS(onDragStateChange)(true);
    })
    .onUpdate((e) => {
      "worklet";
      const delta = isH ? e.translationX : e.translationY;
      const cs = containerSizeSV.value;
      if (cs <= 0) return;
      const cr = collapsedRatio.value;
      const rawSize = (cs - DIVIDER_SIZE) * dragStartRatio.value + delta;
      const r = Math.max(cr, Math.min(rawSize / (cs - DIVIDER_SIZE), 1 - cr));
      ratio.value = r;
    })
    .onEnd(() => {
      "worklet";
      const cr = collapsedRatio.value;
      const snaps = [cr, ...MID_SNAP_POINTS, 1 - cr];
      const r = ratio.value;
      let nearest = snaps[0]!;
      let minDist = Math.abs(r - nearest);
      for (let i = 1; i < snaps.length; i++) {
        const dist = Math.abs(r - snaps[i]!);
        if (dist < minDist) {
          minDist = dist;
          nearest = snaps[i]!;
        }
      }
      ratio.value = withTiming(nearest, { duration: 150 });
      runOnJS(notifyRatioChange)(nearest);
      if (onDragStateChange) runOnJS(onDragStateChange)(false);
    })
    .onFinalize(() => {
      if (onDragStateChange) runOnJS(onDragStateChange)(false);
    });

  const dividerGesture = Gesture.Exclusive(tapGesture, panGesture);

  const firstStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: 0,
    top: 0,
    width: isH ? firstSize.value : "100%",
    height: isH ? "100%" : firstSize.value,
  }));

  const handleStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    ...(isH
      ? { left: firstSize.value, top: 0, width: DIVIDER_SIZE, height: "100%" }
      : { top: firstSize.value, left: 0, height: DIVIDER_SIZE, width: "100%" }),
    zIndex: Z.HEADER,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: t.divider,
    borderLeftWidth: isCustomizing && isH ? 1 : 0,
    borderRightWidth: isCustomizing && isH ? 1 : 0,
    borderTopWidth: isCustomizing && !isH ? 1 : 0,
    borderBottomWidth: isCustomizing && !isH ? 1 : 0,
    borderColor: isCustomizing ? "#58421f" : "transparent",
  }));

  const pillStyle = useAnimatedStyle(() => {
    const cr = collapsedRatio.value;
    const distFromCollapse = Math.min(Math.abs(ratio.value - cr), Math.abs(ratio.value - (1 - cr)));
    const ratioFade = interpolate(distFromCollapse, [0, 0.03], [0, 1], "clamp");
    const sizeFade = interpolate(
      crossAxisSizeSV.value,
      [SIZE_COLLAPSED, SIZE_COLLAPSE_FADE],
      [0, 1],
      "clamp",
    );
    return { opacity: Math.min(ratioFade, sizeFade) };
  });

  const secondStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    ...(isH
      ? {
          left: firstSize.value + DIVIDER_SIZE,
          top: 0,
          width: secondSize.value,
          height: "100%",
        }
      : {
          top: firstSize.value + DIVIDER_SIZE,
          left: 0,
          height: secondSize.value,
          width: "100%",
        }),
  }));

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout;
      setDims((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    },
    [],
  );

  const firstCtx = useMemo(
    () => ({
      ratio,
      collapsedRatio,
      position: "first" as const,
      defaultRatio: restoreRatioRef.current,
      direction,
      path,
      parent: parentSplitCtx,
    }),
    [targetRatio, direction, path, parentSplitCtx],
  );
  const secondCtx = useMemo(
    () => ({
      ratio,
      collapsedRatio,
      position: "second" as const,
      defaultRatio: restoreRatioRef.current,
      direction,
      path,
      parent: parentSplitCtx,
    }),
    [targetRatio, direction, path, parentSplitCtx],
  );

  if (!dims.width || !dims.height) {
    return <View className="flex-1" onLayout={handleLayout} />;
  }

  return (
    <View className="flex-1" onLayout={handleLayout}>
      <Animated.View style={firstStyle}>
        <SplitRatioContext.Provider value={firstCtx}>{first}</SplitRatioContext.Provider>
      </Animated.View>
      <GestureDetector gesture={dividerGesture}>
        <Animated.View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Resize ${isH ? "columns" : "rows"}`}
          style={[handleStyle, { cursor: isH ? "col-resize" : "row-resize" } as never]}
        >
          <Animated.View
            style={[
              {
                width: isH ? 4 : 32,
                height: isH ? 32 : 4,
                backgroundColor: t.dividerPill,
                borderRadius: 2,
              },
              pillStyle,
            ]}
          />
        </Animated.View>
      </GestureDetector>
      <Animated.View style={secondStyle}>
        <SplitRatioContext.Provider value={secondCtx}>{second}</SplitRatioContext.Provider>
      </Animated.View>
    </View>
  );
}
