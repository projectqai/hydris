import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { useCameraPan } from "../../../../lib/api/use-camera-pan";

const CHEVRON_OPACITY = 0.55;
const CHEVRON_SIZE = 20;
const CHEVRON_INSET = 6;
const CHEVRON_HALO_COLOR = "rgba(0,0,0,0.55)";
const STRIP_WIDTH_PCT = 40;
const RIGHT_STRIP_OFFSET = (100 - STRIP_WIDTH_PCT) / 100;

function ChevronHint({ Icon, side }: { Icon: LucideIcon; side: "left" | "right" }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        [side]: CHEVRON_INSET,
        top: 0,
        bottom: 0,
        justifyContent: "center",
      }}
    >
      <Icon
        size={CHEVRON_SIZE}
        color={CHEVRON_HALO_COLOR}
        strokeWidth={4}
        style={{ position: "absolute" }}
      />
      <Icon
        size={CHEVRON_SIZE}
        color="white"
        strokeWidth={2}
        style={{ opacity: CHEVRON_OPACITY }}
      />
    </View>
  );
}

const stripStyleBase = {
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  width: `${STRIP_WIDTH_PCT}%` as const,
  cursor: (Platform.OS === "web" ? "ew-resize" : undefined) as never,
};

export function CameraPanOverlay({
  camera,
  children,
}: {
  camera: Entity | undefined;
  children: ReactNode;
}) {
  const { enabled, pan } = useCameraPan(camera);
  const widthRef = useRef(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  const leftGesture = useMemo(() => {
    const fire = (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      void pan((x - w / 2) / (w / 2));
    };
    return Gesture.Tap()
      .maxDuration(10_000)
      .maxDistance(10_000)
      .onEnd((e, success) => {
        "worklet";
        if (!success) return;
        runOnJS(fire)(e.x);
      });
  }, [pan]);

  const rightGesture = useMemo(() => {
    const fire = (xInStrip: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const absX = xInStrip + RIGHT_STRIP_OFFSET * w;
      void pan((absX - w / 2) / (w / 2));
    };
    return Gesture.Tap()
      .maxDuration(10_000)
      .maxDistance(10_000)
      .onEnd((e, success) => {
        "worklet";
        if (!success) return;
        runOnJS(fire)(e.x);
      });
  }, [pan]);

  if (!enabled) return <>{children}</>;

  return (
    <View style={{ flex: 1 }} onLayout={handleLayout}>
      {children}
      <GestureDetector gesture={leftGesture}>
        <View
          accessibilityLabel="Tap left to pan camera left"
          style={{ ...stripStyleBase, left: 0 }}
        >
          <ChevronHint Icon={ChevronLeft} side="left" />
        </View>
      </GestureDetector>
      <GestureDetector gesture={rightGesture}>
        <View
          accessibilityLabel="Tap right to pan camera right"
          style={{ ...stripStyleBase, right: 0 }}
        >
          <ChevronHint Icon={ChevronRight} side="right" />
        </View>
      </GestureDetector>
    </View>
  );
}
