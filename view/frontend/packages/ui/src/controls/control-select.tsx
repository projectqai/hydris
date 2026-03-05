import { LinearGradient } from "expo-linear-gradient";
import { Pressable, Text, View } from "react-native";

import type { ThemeColors } from "../lib/theme";
import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

export type SelectOption = string | { value: string; label: string };

function optionValue(opt: SelectOption): string {
  return typeof opt === "string" ? opt : opt.value;
}

function optionLabel(opt: SelectOption): string {
  return typeof opt === "string" ? opt : opt.label;
}

export type ControlSelectProps = {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
};

function getChipShadow(t: ThemeColors, selected: boolean) {
  if (selected) {
    return {
      shadowColor: t.activeGreen,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
    };
  }
  return {
    shadowColor: t.controlShadow.color,
    shadowOffset: { width: 0, height: t.controlShadow.offset },
    shadowOpacity: t.controlShadow.opacity,
    shadowRadius: t.controlShadow.radius,
  };
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const shadow = getChipShadow(t, selected);
  const insetColor = selected ? t.surfaceInsetSelected : t.surfaceInset;
  const fg = selected ? t.controlInputBg : t.controlFg;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      tabIndex={0}
      className="group cursor-pointer active:opacity-90"
    >
      <View style={{ borderRadius: 8, ...shadow }}>
        <View
          className={cn(
            "h-8 flex-row items-center gap-2 overflow-hidden rounded-lg border px-3",
            selected
              ? "bg-active-green border-active-green"
              : "bg-control border-control-border group-hover:bg-control-hover group-hover:border-control-border-hover",
          )}
        >
          <LinearGradient
            colors={[insetColor, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            className="pointer-events-none absolute inset-x-0 top-0 h-3/5"
          />
          <View
            style={{
              borderRadius: 7,
              elevation: 6,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.5,
              shadowRadius: 4,
            }}
          >
            <LinearGradient
              colors={selected ? t.controlTrackOn : t.controlTrackOff}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                overflow: "hidden",
              }}
            />
          </View>
          <Text className="font-mono text-xs select-none" style={{ color: fg }} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function ControlSelect({
  value,
  options,
  onValueChange,
  accessibilityLabel,
}: ControlSelectProps) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className="flex-row flex-wrap gap-1.5"
    >
      {options.map((opt) => (
        <Chip
          key={optionValue(opt)}
          label={optionLabel(opt)}
          selected={value === optionValue(opt)}
          onPress={() => onValueChange(optionValue(opt))}
        />
      ))}
    </View>
  );
}
