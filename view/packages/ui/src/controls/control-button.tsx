import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { useState } from "react";
import type { AccessibilityState } from "react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { ThemeColors } from "../lib/theme";
import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

type Variant = "default" | "active" | "success" | "destructive";
type Size = "sm" | "md" | "lg";

const RADIUS = 8;

const VARIANT_CLASSES: Record<Variant, string> = {
  default:
    "bg-control border-control-border group-hover:bg-control-hover group-hover:border-control-border-hover",
  active: "bg-control-hover border-control-border-hover",
  success: "bg-active-green border-active-green",
  destructive: "bg-destructive border-destructive",
};

// When hoverVariant is used, JS drives the variant swap — strip CSS hover classes
const VARIANT_CLASSES_NO_HOVER: Record<Variant, string> = {
  default: "bg-control border-control-border",
  active: "bg-control-hover border-control-border-hover",
  success: "bg-active-green border-active-green",
  destructive: "bg-destructive border-destructive",
};

const DISABLED_CLASSES = "bg-control border-control-border";

function getShadowStyle(t: ThemeColors, variant: Variant, disabled: boolean) {
  if (disabled) return undefined;
  if (variant === "success") {
    return {
      shadowColor: t.activeGreen,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
    };
  }
  if (variant === "destructive") {
    return {
      shadowColor: t.destructiveRed,
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

function getFilledFg(t: ThemeColors, variant: Variant): string {
  if (variant === "destructive") return "rgb(255, 255, 255)";
  return t.controlInputBg;
}

function getFg(t: ThemeColors, variant: Variant, disabled: boolean): string {
  if (disabled) return t.controlFgDisabled;
  if (variant === "success" || variant === "destructive") return getFilledFg(t, variant);
  if (variant === "active") return t.controlFgActive;
  return t.controlFg;
}

function getIconColor(t: ThemeColors, variant: Variant, disabled: boolean): string {
  if (disabled) return t.controlFgDisabled;
  if (variant === "success" || variant === "destructive") return getFilledFg(t, variant);
  if (variant === "active") return t.iconActive;
  return t.iconDefault;
}

function getInsetColor(t: ThemeColors, variant: Variant): string {
  return variant === "success" || variant === "destructive"
    ? t.surfaceInsetSelected
    : t.surfaceInset;
}

function InsetGradient({ color }: { color: string }) {
  return (
    <LinearGradient
      colors={[color, "transparent"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="pointer-events-none absolute inset-x-0 top-0 h-3/5"
    />
  );
}

export type ControlIconButtonProps = {
  icon: LucideIcon;
  iconSize?: number;
  iconStrokeWidth?: number;
  iconColor?: string;
  onPress: () => void;
  variant?: Variant;
  hoverVariant?: Variant;
  size?: Size;
  disabled?: boolean;
  accessibilityLabel: string;
};

const ICON_SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
};

export function ControlIconButton({
  icon: Icon,
  iconSize = 14,
  iconStrokeWidth = 2,
  iconColor,
  onPress,
  variant = "default",
  hoverVariant,
  size = "md",
  disabled,
  accessibilityLabel,
}: ControlIconButtonProps) {
  const t = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const resolved = !disabled && hovered && hoverVariant ? hoverVariant : variant;
  const shadow = getShadowStyle(t, resolved, !!disabled);
  const resolvedColor = iconColor ?? getIconColor(t, resolved, !!disabled);
  const insetColor = getInsetColor(t, resolved);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={hoverVariant ? () => setHovered(true) : undefined}
      onHoverOut={hoverVariant ? () => setHovered(false) : undefined}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "group select-none focus:outline-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer active:opacity-90",
      )}
    >
      <View style={{ borderRadius: RADIUS, ...shadow }}>
        <View
          className={cn(
            "items-center justify-center overflow-hidden rounded-lg border",
            ICON_SIZE_CLASSES[size],
            disabled
              ? DISABLED_CLASSES
              : (hoverVariant ? VARIANT_CLASSES_NO_HOVER : VARIANT_CLASSES)[resolved],
          )}
        >
          <InsetGradient color={insetColor} />
          <Icon aria-hidden size={iconSize} strokeWidth={iconStrokeWidth} color={resolvedColor} />
        </View>
      </View>
    </Pressable>
  );
}

export type ControlButtonProps = {
  onPress: () => void;
  label?: string;
  children?: ReactNode;
  icon?: LucideIcon;
  iconSize?: number;
  iconStrokeWidth?: number;
  variant?: Variant;
  hoverVariant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  labelClassName?: string;
  className?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
};

const CONTENT_SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8",
  md: "h-9",
  lg: "h-11",
};

export function ControlButton({
  onPress,
  label,
  children,
  icon: Icon,
  iconSize = 14,
  iconStrokeWidth = 2,
  variant = "default",
  hoverVariant,
  size = "md",
  disabled,
  loading,
  fullWidth,
  labelClassName,
  className,
  accessibilityLabel,
  accessibilityState,
}: ControlButtonProps) {
  const t = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const resolved = !disabled && hovered && hoverVariant ? hoverVariant : variant;
  const shadow = getShadowStyle(t, resolved, !!disabled);
  const fg = getFg(t, resolved, !!disabled);
  const iconFg = getIconColor(t, resolved, !!disabled);
  const insetColor = getInsetColor(t, resolved);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={hoverVariant ? () => setHovered(true) : undefined}
      onHoverOut={hoverVariant ? () => setHovered(false) : undefined}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true, ...accessibilityState } : accessibilityState}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "group select-none focus:outline-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer active:opacity-90",
        fullWidth && "w-full",
        className,
      )}
    >
      <View style={{ borderRadius: RADIUS, ...shadow }}>
        <View
          className={cn(
            "flex-row items-center justify-center gap-1.5 overflow-hidden rounded-lg border px-3",
            CONTENT_SIZE_CLASSES[size],
            disabled
              ? DISABLED_CLASSES
              : (hoverVariant ? VARIANT_CLASSES_NO_HOVER : VARIANT_CLASSES)[resolved],
          )}
        >
          <InsetGradient color={insetColor} />
          {loading ? (
            <ActivityIndicator size={14} color={fg} />
          ) : label ? (
            <>
              {Icon && (
                <Icon aria-hidden size={iconSize} strokeWidth={iconStrokeWidth} color={iconFg} />
              )}
              <Text
                className={cn("font-sans-medium text-13", labelClassName)}
                style={{ color: fg }}
              >
                {label}
              </Text>
            </>
          ) : (
            children
          )}
        </View>
      </View>
    </Pressable>
  );
}
