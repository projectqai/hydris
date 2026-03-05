import { Minus, Plus } from "lucide-react-native";
import { useCallback, useRef } from "react";
import type { TextInput } from "react-native";
import { Text, View } from "react-native";

import { ControlIconButton } from "./control-button";
import { ControlInput } from "./control-input";

export type ControlStepperProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step: number;
  unit?: string;
  readOnly?: boolean;
  accessibilityLabel: string;
};

function clamp(value: number, min?: number, max?: number): number {
  if (min != null && value < min) return min;
  if (max != null && value > max) return max;
  return value;
}

export function ControlStepper({
  value,
  onValueChange,
  min,
  max,
  step,
  unit,
  readOnly,
  accessibilityLabel,
}: ControlStepperProps) {
  const inputRef = useRef<TextInput>(null);
  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;

  const decrement = useCallback(() => {
    onValueChange(clamp(value - step, min, max));
  }, [value, step, min, max, onValueChange]);

  const increment = useCallback(() => {
    onValueChange(clamp(value + step, min, max));
  }, [value, step, min, max, onValueChange]);

  const handleTextChange = useCallback(
    (text: string) => {
      const num = Number(text);
      if (!Number.isNaN(num)) {
        onValueChange(clamp(num, min, max));
      }
    },
    [min, max, onValueChange],
  );

  return (
    <View className="flex-row items-center gap-1.5">
      <ControlIconButton
        icon={Minus}
        iconSize={14}
        iconStrokeWidth={2}
        onPress={decrement}
        size="sm"
        disabled={readOnly || atMin}
        accessibilityLabel={`Decrease ${accessibilityLabel}`}
      />
      <ControlInput
        ref={inputRef}
        value={String(value)}
        onChangeText={handleTextChange}
        keyboardType="numeric"
        editable={!readOnly}
        accessibilityLabel={accessibilityLabel}
        className="w-16 text-center tabular-nums"
      />
      {unit && <Text className="text-on-surface/65 font-mono text-xs">{unit}</Text>}
      <ControlIconButton
        icon={Plus}
        iconSize={14}
        iconStrokeWidth={2}
        onPress={increment}
        size="sm"
        disabled={readOnly || atMax}
        accessibilityLabel={`Increase ${accessibilityLabel}`}
      />
    </View>
  );
}
