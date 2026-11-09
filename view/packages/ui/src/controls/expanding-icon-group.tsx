"use no memo";

import type { LucideIcon } from "lucide-react-native";
import { useEffect } from "react";
import type { ViewStyle } from "react-native";
import { View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";

import { ControlIconButton } from "./control-button";

export type ExpandingIconGroupOption = {
  id: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  iconColor?: string;
};

const BUTTON_SIZE = 40;
const GAP = 8;
const STAGGER_MS = 15;
const START_OFFSET = 10;
const START_SCALE = 0.9;

const SPRING_CONFIG = {
  duration: 160,
  dampingRatio: 1,
};

const REVEAL: ViewStyle = {
  position: "absolute",
  right: "100%",
  top: 0,
  marginRight: GAP,
  height: BUTTON_SIZE,
};

function ExpandingIconGroupButton({
  option,
  index,
  optionCount,
  expanded,
  onSelect,
  iconSize,
}: {
  option: ExpandingIconGroupOption;
  index: number;
  optionCount: number;
  expanded: boolean;
  onSelect: (id: string) => void;
  iconSize: number;
}) {
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    // The trigger is on the right, so the last rendered option enters first.
    const order = expanded ? optionCount - index - 1 : index;
    progress.value = withDelay(
      order * STAGGER_MS,
      withSpring(expanded ? 1 : 0, { ...SPRING_CONFIG, reduceMotion: ReduceMotion.System }),
      ReduceMotion.System,
    );
  }, [expanded, index, optionCount, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: Math.min(progress.value * 2, 1),
    transform: [
      { translateX: (1 - progress.value) * START_OFFSET },
      { scale: START_SCALE + progress.value * (1 - START_SCALE) },
    ],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <ControlIconButton
        icon={option.icon}
        iconSize={iconSize}
        iconColor={option.iconColor}
        onPress={() => onSelect(option.id)}
        variant={option.active ? "active" : "default"}
        size="lg"
        accessibilityLabel={option.label}
        aria-pressed={option.active ?? false}
        tabIndex={expanded ? 0 : -1}
      />
    </Animated.View>
  );
}

export function ExpandingIconGroup({
  icon,
  label,
  options,
  expanded,
  onExpandedChange,
  onSelect,
  iconSize = 16,
}: {
  icon: LucideIcon;
  label: string;
  options: readonly ExpandingIconGroupOption[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (id: string) => void;
  iconSize?: number;
}) {
  const openWidth = options.length * BUTTON_SIZE + Math.max(options.length - 1, 0) * GAP;
  const activeOption = options.find((option) => option.active);

  return (
    <View className="relative self-end">
      <ControlIconButton
        icon={icon}
        iconSize={iconSize}
        iconColor={activeOption?.iconColor}
        onPress={() => onExpandedChange(!expanded)}
        variant={expanded || activeOption ? "active" : "default"}
        size="lg"
        accessibilityLabel={label}
        aria-expanded={expanded}
      />

      <View
        style={[REVEAL, { width: openWidth }]}
        pointerEvents={expanded ? "auto" : "none"}
        aria-hidden={!expanded}
      >
        <View className="absolute top-0 right-0 flex-row items-center gap-2">
          {options.map((option, index) => (
            <ExpandingIconGroupButton
              key={option.id}
              option={option}
              index={index}
              optionCount={options.length}
              expanded={expanded}
              onSelect={onSelect}
              iconSize={iconSize}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
