import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { METRIC_TOKENS } from "./lib/metric-tokens";
import { cn } from "./lib/utils";

export function TileFrame({ className, children }: PropsWithChildren<{ className?: string }>) {
  return (
    <View className={cn("border-background bg-background flex-1 border", className)}>
      <View className="flex-1 overflow-hidden" style={{ padding: METRIC_TOKENS.padding }}>
        {children}
      </View>
    </View>
  );
}
