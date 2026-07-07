import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { METRIC_TOKENS } from "./lib/metric-tokens";

export type TileHeaderSizes = { name: number; text: number; icon: number; gap: number };

export type TileHeaderContent = {
  name: string | undefined;
  timestamp?: string;
  meta?: (sizes: TileHeaderSizes) => ReactNode;
};

const DEFAULT_SIZES: TileHeaderSizes = {
  name: METRIC_TOKENS.headerText,
  text: METRIC_TOKENS.headerText,
  icon: Math.round(METRIC_TOKENS.headerText * 1.3),
  gap: 8,
};

export function TileHeader({
  content,
  sizes = DEFAULT_SIZES,
}: {
  content: TileHeaderContent;
  sizes?: TileHeaderSizes;
}) {
  return (
    <View className="flex-row items-center justify-between" style={{ marginBottom: sizes.gap }}>
      <Text
        className="font-sans-semibold text-foreground/80 min-w-0 shrink"
        style={{ fontSize: sizes.name }}
        numberOfLines={1}
      >
        {content.name}
      </Text>
      <View className="ml-3 shrink-0 flex-row items-center" style={{ gap: 8 }}>
        {content.timestamp ? (
          <Text
            className="font-sans-semibold text-foreground/70 tabular-nums"
            style={{ fontSize: sizes.text }}
          >
            {content.timestamp}
          </Text>
        ) : null}
        {content.meta?.(sizes)}
      </View>
    </View>
  );
}
