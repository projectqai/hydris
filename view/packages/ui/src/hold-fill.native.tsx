import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import type { HoldFillProps } from "./hold-fill";
import { cn } from "./lib/utils";

const STYLES = StyleSheet.create({
  window: { position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" },
});

// Android has no clip-path. A clipping window slides in from the left and its content moves the
// opposite way by the same distance, so the content stays put while more of it shows.
export function HoldFill({ progress, className, children }: HoldFillProps) {
  const [width, setWidth] = useState(0);

  const windowStyle = useAnimatedStyle(() => ({
    opacity: width === 0 ? 0 : 1,
    transform: [{ translateX: -(1 - progress.get()) * width }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.get()) * width }],
  }));

  return (
    <Animated.View
      testID="hold-fill"
      style={[STYLES.window, windowStyle]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
        <View className={cn("flex-1", className)}>{children}</View>
      </Animated.View>
    </Animated.View>
  );
}
