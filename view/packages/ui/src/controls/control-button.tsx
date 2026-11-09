import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { ThemeColors } from "../lib/theme";
import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

export type ControlButtonVariant = "default" | "active" | "success" | "destructive" | "error";

type Variant = ControlButtonVariant;
type Size = "sm" | "md" | "lg";

const RADIUS = 8;

const VARIANT_CLASSES: Record<Variant, string> = {
  default:
    "bg-control border-control-border group-hover:bg-control-hover group-hover:border-control-border-hover",
  active: "bg-control-hover border-control-border-hover",
  success: "bg-active-green border-active-green",
  destructive: "bg-destructive border-destructive",
  error: "bg-control border-destructive group-hover:bg-control-hover",
};

// When hoverVariant is used, JS drives the variant swap — strip CSS hover classes
const VARIANT_CLASSES_NO_HOVER: Record<Variant, string> = {
  default: "bg-control border-control-border",
  active: "bg-control-hover border-control-border-hover",
  success: "bg-active-green border-active-green",
  destructive: "bg-destructive border-destructive",
  error: "bg-control border-destructive",
};

const DISABLED_CLASSES = "bg-control border-control-border";

// A drop shadow and a light inset that fades down from the top edge. Other controls use them too.
// Filled variants glow in their own color instead of casting a shadow.
export function controlButtonShadow(t: ThemeColors, variant: Variant, disabled: boolean) {
  if (disabled) return undefined;

  if (variant === "success" || variant === "destructive") {
    const glowColor = variant === "success" ? t.activeGreenGlow : t.destructiveRedGlow;

    return { boxShadow: `0 0 8px ${glowColor}` };
  }

  return { boxShadow: t.controlBoxShadow };
}

export function ControlButtonInset({ variant }: { variant: Variant }) {
  const t = useThemeColors();
  const filled = variant === "success" || variant === "destructive";

  return (
    <LinearGradient
      colors={[filled ? t.surfaceInsetSelected : t.surfaceInset, "transparent"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="pointer-events-none absolute inset-x-0 top-0 h-3/5"
    />
  );
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
  tabIndex?: -1 | 0;
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
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
  tabIndex = 0,
  "aria-expanded": ariaExpanded,
  "aria-pressed": ariaPressed,
}: ControlIconButtonProps) {
  const t = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const resolved = !disabled && hovered && hoverVariant ? hoverVariant : variant;
  const shadow = controlButtonShadow(t, resolved, !!disabled);
  const resolvedColor = iconColor ?? getIconColor(t, resolved, !!disabled);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={hoverVariant ? () => setHovered(true) : undefined}
      onHoverOut={hoverVariant ? () => setHovered(false) : undefined}
      disabled={disabled}
      role="button"
      accessibilityLabel={accessibilityLabel}
      aria-expanded={ariaExpanded}
      aria-pressed={ariaPressed}
      tabIndex={disabled ? -1 : tabIndex}
      className={cn(
        "group select-none focus:outline-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer active:opacity-90",
      )}
    >
      <View style={{ borderRadius: RADIUS }}>
        <View
          style={shadow}
          className={cn(
            "items-center justify-center overflow-hidden rounded-lg border",
            ICON_SIZE_CLASSES[size],
            disabled
              ? DISABLED_CLASSES
              : (hoverVariant ? VARIANT_CLASSES_NO_HOVER : VARIANT_CLASSES)[resolved],
          )}
        >
          <ControlButtonInset variant={resolved} />
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
  "aria-expanded"?: boolean;
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
  "aria-expanded": ariaExpanded,
}: ControlButtonProps) {
  const t = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const resolved = !disabled && hovered && hoverVariant ? hoverVariant : variant;
  const shadow = controlButtonShadow(t, resolved, !!disabled);
  const fg = getFg(t, resolved, !!disabled);
  const iconFg = getIconColor(t, resolved, !!disabled);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={hoverVariant ? () => setHovered(true) : undefined}
      onHoverOut={hoverVariant ? () => setHovered(false) : undefined}
      disabled={disabled}
      role="button"
      accessibilityLabel={accessibilityLabel}
      aria-expanded={ariaExpanded}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "group select-none focus:outline-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer active:opacity-90",
        fullWidth && "w-full",
        className,
      )}
    >
      <View style={{ borderRadius: RADIUS }}>
        <View
          style={shadow}
          className={cn(
            "flex-row items-center justify-center gap-1.5 overflow-hidden rounded-lg border px-3",
            CONTENT_SIZE_CLASSES[size],
            disabled
              ? DISABLED_CLASSES
              : (hoverVariant ? VARIANT_CLASSES_NO_HOVER : VARIANT_CLASSES)[resolved],
          )}
        >
          <ControlButtonInset variant={resolved} />
          {label ? (
            <>
              {Icon && !loading && (
                <Icon aria-hidden size={iconSize} strokeWidth={iconStrokeWidth} color={iconFg} />
              )}
              {loading && <ActivityIndicator size={14} color={fg} />}
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
