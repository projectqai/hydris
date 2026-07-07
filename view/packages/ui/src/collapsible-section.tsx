"use no memo";

import { ChevronDown } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";

export type SectionTone = "ok" | "warn" | "fail";

function toneTextClass(tone: SectionTone): string {
  switch (tone) {
    case "ok":
      return "text-success-foreground";
    case "warn":
      return "text-pending-foreground";
    case "fail":
      return "text-red-foreground";
  }
}

export function CollapsibleSection({
  label,
  count,
  tone,
  description = "",
  defaultExpanded = false,
  topBorder = true,
  children,
}: {
  label: string;
  count: number;
  tone: SectionTone;
  description?: string;
  defaultExpanded?: boolean;
  topBorder?: boolean;
  children?: ReactNode;
}) {
  const t = useThemeColors();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasBody = description.length > 0 || children != null;
  const rotationValue = useSharedValue(defaultExpanded ? 180 : 0);
  useEffect(() => {
    rotationValue.value = withTiming(expanded ? 180 : 0, { duration: 120 });
  }, [expanded, rotationValue]);
  const rotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotationValue.value}deg` }],
  }));
  return (
    <View className={cn("border-foreground/8", topBorder && "border-t")}>
      <Pressable
        role="button"
        onPress={() => hasBody && setExpanded((v) => !v)}
        disabled={!hasBody}
        className="flex-row items-center gap-2 px-4 py-2 select-none"
      >
        <Text className={cn("font-sans-medium text-sm", toneTextClass(tone))}>{label}</Text>
        <View className="bg-surface-overlay/10 h-5 items-center justify-center rounded px-1.5">
          <Text className="text-on-surface/85 text-11 font-mono leading-none tabular-nums">
            {count}
          </Text>
        </View>
        {hasBody ? (
          <Animated.View style={[rotation, { marginLeft: "auto" }]}>
            <ChevronDown size={14} strokeWidth={2} color={t.iconMuted} />
          </Animated.View>
        ) : null}
      </Pressable>
      {expanded && hasBody ? (
        <View className="px-4 pb-2">
          {description ? (
            <Text className="text-muted-foreground text-11 font-mono leading-relaxed">
              {description}
            </Text>
          ) : null}
          {children ? <View className="mt-1">{children}</View> : null}
        </View>
      ) : null}
    </View>
  );
}
