import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Children, createContext, use, useCallback, useMemo } from "react";
import { type NativeSyntheticEvent, Pressable, Text, View } from "react-native";

import { ControlButtonInset, controlButtonShadow } from "./controls/control-button";
import { ItemIndexContext, type RovingItem, useRovingFocus } from "./hooks/use-roving-focus";
import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";

type RadioGroupContextValue = {
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  registerItem: (value: string, item: RovingItem) => () => void;
  moveFocus: (from: string, step: number, wrap: boolean) => string | undefined;
};

const ARROW_STEPS: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function useRadioGroup() {
  const context = use(RadioGroupContext);

  if (!context) throw new Error("RadioGroupItem must be rendered inside a RadioGroup");

  return context;
}

// React Native has no fieldset or legend, so the group carries its own accessible label
export function RadioGroup({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const { registerItem, moveFocus } = useRovingFocus();

  const context = useMemo(
    () => ({ value, onValueChange, disabled, registerItem, moveFocus }),
    [value, onValueChange, disabled, registerItem, moveFocus],
  );

  return (
    <RadioGroupContext value={context}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={accessibilityLabel}
        className={cn("flex-row flex-wrap gap-1.5", className)}
      >
        {Children.map(children, (child, index) => (
          <ItemIndexContext value={index}>{child}</ItemIndexContext>
        ))}
      </View>
    </RadioGroupContext>
  );
}

const ITEM_STYLES = {
  box: "h-8 flex-row items-center gap-2 overflow-hidden rounded-lg border px-3",
  checked: "bg-active-green border-active-green",
  unchecked:
    "bg-control border-control-border group-hover:bg-control-hover group-hover:border-control-border-hover",
  label: "font-mono text-xs select-none",
};

// React Native has no :has() selector, so the item owns its look and holds its label
export function RadioGroupItem({
  value,
  disabled = false,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const group = useRadioGroup();
  const index = use(ItemIndexContext);
  const checked = group.value === value;
  const variant = checked ? "success" : "default";
  const inactive = group.disabled || disabled;
  const { registerItem } = group;

  const ref = useCallback(
    (node: View | null) => {
      if (!node) return;

      return registerItem(value, { index, disabled: inactive, node });
    },
    [registerItem, value, index, inactive],
  );

  // React Native has no radio input, so the item handles Space and arrows, and Enter presses it too
  const onKeyDown = (event: NativeSyntheticEvent<{ key: string }>) => {
    const { key } = event.nativeEvent;
    const step = ARROW_STEPS[key];

    if (inactive || (key !== " " && step === undefined)) return;

    event.preventDefault();
    event.stopPropagation();

    if (step === undefined) {
      group.onValueChange(value);

      return;
    }

    const next = group.moveFocus(value, step, true);

    if (next !== undefined) group.onValueChange(next);
  };

  return (
    <Pressable
      ref={ref}
      onPress={() => group.onValueChange(value)}
      // @ts-expect-error onKeyDown is a React Native Web prop
      onKeyDown={onKeyDown}
      disabled={inactive}
      accessibilityRole="radio"
      aria-checked={checked}
      className={cn("group cursor-pointer active:opacity-90", className)}
    >
      <View
        className={cn(ITEM_STYLES.box, checked ? ITEM_STYLES.checked : ITEM_STYLES.unchecked)}
        style={controlButtonShadow(t, variant, false)}
      >
        <ControlButtonInset variant={variant} />
        <View style={{ borderRadius: 7, boxShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
          <LinearGradient
            colors={checked ? t.controlTrackOn : t.controlTrackOff}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ width: 14, height: 14, borderRadius: 7, overflow: "hidden" }}
          />
        </View>
        <Text
          className={ITEM_STYLES.label}
          style={{ color: checked ? t.controlInputBg : t.controlFg }}
          numberOfLines={1}
        >
          {children}
        </Text>
      </View>
    </Pressable>
  );
}
