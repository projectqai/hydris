"use no memo";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { GradientPanel } from "../lib/theme";
import { cn } from "../lib/utils";

export type FloatingWindowConfig = {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  edgePadding?: number;
};

type FloatingWindowProps = {
  isVisible: boolean;
  header?: ReactNode;
  content?: ReactNode;
  footer?: ReactNode;
  config?: FloatingWindowConfig;
  minTop?: number;
  initialPosition?: { x: number; y: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
};

const DEFAULT_CONFIG: Required<FloatingWindowConfig> = {
  minWidth: 200,
  minHeight: 150,
  maxWidth: 800,
  maxHeight: 600,
  defaultWidth: 400,
  defaultHeight: 300,
  edgePadding: 12,
};

const SPRING_CONFIG = {
  damping: 15,
  mass: 1,
  stiffness: 120,
  overshootClamping: true,
  restSpeedThreshold: 2,
  restDisplacementThreshold: 0.01,
};

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

export function FloatingWindow({
  isVisible,
  header,
  content,
  footer,
  config: userConfig,
  minTop = 0,
  initialPosition,
  onPositionChange,
}: FloatingWindowProps) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [isPositioned, setIsPositioned] = useState(false);
  const hasInitialized = useRef(false);

  const minY = useSharedValue(minTop);

  useEffect(() => {
    minY.value = minTop;
  }, [minTop]);

  const width = useSharedValue(config.defaultWidth);
  const height = useSharedValue(config.defaultHeight);
  const positionX = useSharedValue(0);
  const positionY = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const isResizing = useSharedValue(false);
  const lastDragX = useSharedValue(0);
  const lastDragY = useSharedValue(0);

  useEffect(() => {
    if (isVisible && screenWidth > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      if (initialPosition) {
        positionX.value = initialPosition.x;
        positionY.value = Math.max(initialPosition.y, minY.value);
      } else {
        positionX.value = (screenWidth - config.defaultWidth) / 2;
        const centeredY = (screenHeight - config.defaultHeight) / 2;
        positionY.value = Math.max(centeredY, minY.value);
      }
      setIsPositioned(true);
    }
    if (!isVisible) {
      hasInitialized.current = false;
      setIsPositioned(false);
    }
  }, [isVisible, screenWidth, screenHeight]);

  const maxX = useDerivedValue(() => {
    return screenWidth - width.value - config.edgePadding;
  });

  const maxY = useDerivedValue(() => {
    return screenHeight - height.value - config.edgePadding;
  });

  const dragGesture = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = true;
      lastDragX.value = 0;
      lastDragY.value = 0;
    })
    .onChange((e) => {
      const deltaX = e.translationX - lastDragX.value;
      const deltaY = e.translationY - lastDragY.value;
      lastDragX.value = e.translationX;
      lastDragY.value = e.translationY;

      positionX.value = clamp(positionX.value + deltaX, config.edgePadding, maxX.value);
      positionY.value = clamp(positionY.value + deltaY, minY.value, maxY.value);
    })
    .onEnd(() => {
      isDragging.value = false;
      if (onPositionChange) {
        runOnJS(onPositionChange)({ x: positionX.value, y: positionY.value });
      }
    });

  const createResizeGesture = (anchor: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w") => {
    const xDir = anchor.includes("e") ? 1 : anchor.includes("w") ? -1 : 0;
    const yDir = anchor.includes("s") ? 1 : anchor.includes("n") ? -1 : 0;

    return Gesture.Pan()
      .onBegin(() => {
        isResizing.value = true;
        lastDragX.value = 0;
        lastDragY.value = 0;
      })
      .onChange((e) => {
        const deltaX = e.translationX - lastDragX.value;
        const deltaY = e.translationY - lastDragY.value;
        lastDragX.value = e.translationX;
        lastDragY.value = e.translationY;

        let newWidth = width.value;
        let newHeight = height.value;
        let newPosX = positionX.value;
        let newPosY = positionY.value;

        if (xDir) {
          newWidth = clamp(width.value + deltaX * xDir, config.minWidth, config.maxWidth);
          if (xDir < 0) newPosX = positionX.value + (width.value - newWidth);
        }
        if (yDir) {
          newHeight = clamp(height.value + deltaY * yDir, config.minHeight, config.maxHeight);
          if (yDir < 0) newPosY = positionY.value + (height.value - newHeight);
        }

        width.value = newWidth;
        height.value = newHeight;
        positionX.value = clamp(newPosX, config.edgePadding, maxX.value);
        positionY.value = clamp(newPosY, minY.value, maxY.value);
      })
      .onEnd(() => {
        isResizing.value = false;
        width.value = withSpring(width.value, SPRING_CONFIG);
        height.value = withSpring(height.value, SPRING_CONFIG);
      });
  };

  const resizeHandles = [
    {
      gesture: createResizeGesture("se"),
      cursor: "cursor-nwse-resize",
      bottom: 0,
      right: 0,
      width: 16,
      height: 16,
    },
    {
      gesture: createResizeGesture("sw"),
      cursor: "cursor-nesw-resize",
      bottom: 0,
      left: 0,
      width: 16,
      height: 16,
    },
    {
      gesture: createResizeGesture("ne"),
      cursor: "cursor-nesw-resize",
      top: 0,
      right: 0,
      width: 16,
      height: 16,
    },
    {
      gesture: createResizeGesture("nw"),
      cursor: "cursor-nwse-resize",
      top: 0,
      left: 0,
      width: 16,
      height: 16,
    },
    {
      gesture: createResizeGesture("n"),
      cursor: "cursor-ns-resize",
      top: 0,
      left: 16,
      right: 16,
      height: 8,
    },
    {
      gesture: createResizeGesture("s"),
      cursor: "cursor-ns-resize",
      bottom: 0,
      left: 16,
      right: 16,
      height: 8,
    },
    {
      gesture: createResizeGesture("e"),
      cursor: "cursor-ew-resize",
      right: 0,
      top: 16,
      bottom: 16,
      width: 8,
    },
    {
      gesture: createResizeGesture("w"),
      cursor: "cursor-ew-resize",
      left: 0,
      top: 16,
      bottom: 16,
      width: 8,
    },
  ];

  const containerStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      width: width.value,
      height: height.value,
      left: positionX.value,
      top: positionY.value,
      zIndex: 9999,
      userSelect: "none" as any,
    };
  });

  if (!isVisible || !isPositioned) {
    return null;
  }

  return (
    <Animated.View style={containerStyle}>
      <GradientPanel
        variant="dense"
        className="size-full overflow-hidden rounded-xl border border-white/10"
      >
        {header && (
          <GestureDetector gesture={dragGesture}>
            <View collapsable={false} className="cursor-grab active:cursor-grabbing">
              {header}
            </View>
          </GestureDetector>
        )}

        <View className="flex-1 bg-black">{content}</View>

        {footer && (
          <GestureDetector gesture={dragGesture}>
            <View collapsable={false} className="cursor-grab active:cursor-grabbing">
              {footer}
            </View>
          </GestureDetector>
        )}

        {resizeHandles.map((handle, i) => (
          <GestureDetector key={i} gesture={handle.gesture}>
            <View
              className={cn("absolute", handle.cursor)}
              style={{
                top: handle.top,
                bottom: handle.bottom,
                left: handle.left,
                right: handle.right,
                width: handle.width,
                height: handle.height,
              }}
            />
          </GestureDetector>
        ))}
      </GradientPanel>
    </Animated.View>
  );
}
