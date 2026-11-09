import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import { HoldFill } from "./hold-fill";
import { cn } from "./lib/utils";

export const HOLD_DURATION_MS = 700;
export const HOLD_RELEASE_MS = 220;

const HOLD_TEXT = "font-sans-medium text-sm";

const HOLD_LAYER = "pointer-events-none absolute inset-0 items-center justify-center";

export function HoldHint() {
  return (
    <View className={HOLD_LAYER}>
      <Text className={cn(HOLD_TEXT, "text-foreground")}>Hold to confirm</Text>
    </View>
  );
}

export function HoldLabel({
  progress,
  holding,
  ...props
}: ComponentProps<typeof View> & { progress: SharedValue<number>; holding: boolean }) {
  return (
    <View className={HOLD_LAYER} {...props}>
      <Text className={cn(HOLD_TEXT, "text-background")}>Hold to confirm</Text>
      <HoldFill
        progress={progress}
        holding={holding}
        duration={HOLD_DURATION_MS}
        releaseMs={HOLD_RELEASE_MS}
        className="bg-background items-center justify-center"
      >
        <Text aria-hidden className={cn(HOLD_TEXT, "text-foreground")}>
          Hold to confirm
        </Text>
      </HoldFill>
    </View>
  );
}
