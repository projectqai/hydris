import { ArrowRight } from "lucide-react-native";
import type { ComponentType, PropsWithChildren } from "react";
import { createContext, use, useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import type { ThemeColors } from "./lib/theme";
import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";

export type CardVariant = "empty" | "default" | "success" | "info" | "pending" | "alert";

export type CardIconComponent = ComponentType<{
  size: number;
  color: string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
}>;

type CardIconColor = keyof Pick<
  ThemeColors,
  "foreground" | "background" | "green" | "blue" | "pendingForeground"
>;

type CardPartProps = PropsWithChildren<{ className?: string }>;

const ACTIVE_ZOOM = 1.02;

const ACTIVE_TIMING = { duration: 120, reduceMotion: ReduceMotion.System };

const STYLES = StyleSheet.create({ grow: { flex: 1 } });

const CardContext = createContext<{
  variant: CardVariant;
  progress: SharedValue<number>;
} | null>(null);

function useCardContext() {
  const context = use(CardContext);

  if (!context) throw new Error("Card parts must be rendered inside a Card");

  return context;
}

type CardTextStyles = { title: string; description: string; content: string };

const TEXT_STYLES: Record<CardVariant, CardTextStyles> = {
  empty: {
    title: "text-muted-foreground/[.83] dark:text-muted-foreground/75",
    description: "text-muted-foreground/[.83] dark:text-muted-foreground/75",
    content: "text-muted-foreground",
  },
  default: {
    title: "text-muted-foreground/90 dark:text-muted-foreground/85",
    description: "text-muted-foreground/90 dark:text-muted-foreground/85",
    content: "text-muted-foreground",
  },
  success: {
    title: "text-success-foreground/92 dark:text-green/[.76]",
    description: "text-success-foreground/92 dark:text-green/[.76]",
    content: "text-success-foreground/92 dark:text-green/[.76]",
  },
  info: {
    title: "text-blue-foreground/[.89] dark:text-blue-foreground/[.69]",
    description: "text-blue-foreground",
    content: "text-blue-foreground/[.89] dark:text-blue-foreground/[.69]",
  },
  pending: {
    title: "text-pending-foreground/[.91] dark:text-pending-foreground/[.63]",
    description: "text-pending-foreground",
    content: "text-pending-foreground",
  },
  alert: { title: "text-background", description: "text-background", content: "text-background" },
};

const ICON_COLORS: Record<CardVariant, CardIconColor> = {
  empty: "foreground",
  default: "foreground",
  success: "green",
  info: "blue",
  pending: "pendingForeground",
  alert: "background",
};

export function useCard() {
  const { variant } = useCardContext();

  return { variant, text: TEXT_STYLES[variant], iconColor: ICON_COLORS[variant] };
}

type Interaction = { highlighted: boolean; hovered: boolean; pressed: boolean };

function useHoverProgress(highlighted: boolean) {
  const progress = useSharedValue(highlighted ? 1 : 0);
  const interaction = useRef<Interaction>({ highlighted, hovered: false, pressed: false });

  const update = useCallback(
    (change: Partial<Interaction>) => {
      const next = { ...interaction.current, ...change };
      interaction.current = next;
      progress.set(
        withTiming(next.highlighted || next.hovered || next.pressed ? 1 : 0, ACTIVE_TIMING),
      );
    },
    [progress],
  );

  useEffect(() => {
    update({ highlighted });
  }, [highlighted, update]);

  const pressHandlers = useMemo(
    () => ({
      onHoverIn: () => update({ hovered: true }),
      onHoverOut: () => update({ hovered: false }),
      onPressIn: () => update({ pressed: true }),
      onPressOut: () => update({ pressed: false }),
    }),
    [update],
  );

  return { progress, pressHandlers };
}

const SURFACE_STYLES: Record<CardVariant, { base: string; rest: string; hover: string }> = {
  empty: {
    base: "border border-dashed border-control-border-hover",
    rest: "",
    hover: "border border-dashed border-control-text-muted dark:border-control-fg-disabled",
  },
  default: { base: "", rest: "bg-glass", hover: "bg-glass-hover" },
  success: { base: "", rest: "bg-green/6", hover: "bg-green/10" },
  info: { base: "", rest: "bg-blue/6", hover: "bg-blue/10" },
  pending: { base: "", rest: "bg-pending/5", hover: "bg-pending/[.09]" },
  alert: { base: "border border-warning bg-warning", rest: "", hover: "bg-surface-overlay/12" },
};

export function Card({
  variant = "default",
  onPress,
  highlighted = false,
  className,
  children,
}: CardPartProps & { variant?: CardVariant; onPress?: () => void; highlighted?: boolean }) {
  const surface = SURFACE_STYLES[variant];
  const { progress, pressHandlers } = useHoverProgress(highlighted);
  const context = useMemo(() => ({ variant, progress }), [variant, progress]);
  const restFade = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const hoverFade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const classes = cn("grow justify-between gap-2.5 rounded p-2.5", className);

  // className does not reach Animated.View on web, so it only carries layout and the fade
  const layers = (
    <>
      <View className={cn("absolute inset-0 rounded", surface.base)} />
      <Animated.View style={[StyleSheet.absoluteFill, restFade]}>
        <View className={cn("flex-1 rounded", surface.rest)} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, hoverFade]}>
        <View className={cn("flex-1 rounded", surface.hover)} />
      </Animated.View>
    </>
  );

  return (
    <CardContext value={context}>
      {onPress ? (
        <Pressable
          role="button"
          onPress={onPress}
          tabIndex={-1}
          {...pressHandlers}
          className={cn("select-none", classes)}
        >
          {layers}
          {children}
        </Pressable>
      ) : (
        <View className={classes}>
          {layers}
          {children}
        </View>
      )}
    </CardContext>
  );
}

export function CardHeader({ className, children }: CardPartProps) {
  return (
    <View className={cn("min-h-[17px] flex-row flex-wrap items-start gap-y-1.5", className)}>
      {children}
    </View>
  );
}

const TITLE_ICON_CLASSES: Record<CardVariant, string> = {
  empty: "opacity-20",
  default: "opacity-20",
  success: "opacity-20",
  info: "opacity-20",
  pending: "opacity-20",
  alert: "",
};

export function CardTitle({
  icon: Icon,
  className,
  children,
}: CardPartProps & { icon?: CardIconComponent }) {
  const { variant, text, iconColor } = useCard();
  const t = useThemeColors();

  return (
    <View className="min-w-0 shrink grow basis-2/5 flex-row items-center gap-2">
      {Icon && (
        <View aria-hidden className={TITLE_ICON_CLASSES[variant]}>
          <Icon size={16} color={t[iconColor]} strokeWidth={1} absoluteStrokeWidth />
        </View>
      )}
      <Text
        className={cn("text-11 min-w-0 shrink font-mono leading-tight", text.title, className)}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

export function CardDescription({ className, children }: CardPartProps) {
  const description = useCard().text.description;

  return (
    <Text
      className={cn("text-11 min-w-0 shrink font-mono leading-tight", description, className)}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

const PILL_STYLES: Record<CardVariant, { fill: string; label: string }> = {
  empty: { fill: "bg-muted-foreground/10", label: "text-muted-foreground" },
  default: { fill: "bg-muted-foreground/10", label: "text-muted-foreground" },
  success: {
    fill: "bg-success-foreground/10 dark:bg-green/10",
    label: "text-success-foreground dark:text-green",
  },
  info: { fill: "bg-blue-foreground/10", label: "text-blue-foreground" },
  pending: { fill: "bg-pending-foreground", label: "text-background" },
  alert: { fill: "bg-background", label: "text-warning" },
};

export function CardPill({ className, children }: CardPartProps) {
  const pill = PILL_STYLES[useCard().variant];

  return (
    <View className={cn("items-center rounded-full px-5 py-2", pill.fill, className)}>
      <Text className={cn("text-13 font-sans leading-4 uppercase", pill.label)}>{children}</Text>
    </View>
  );
}

export function CardAction({ className, children }: CardPartProps) {
  return (
    <View
      className={cn("ml-auto min-w-0 shrink flex-row items-center justify-end gap-2", className)}
    >
      {children}
    </View>
  );
}

export function CardContent({ className, children }: CardPartProps) {
  const { progress } = useCardContext();

  const zoom = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (ACTIVE_ZOOM - 1) * progress.get() }],
  }));

  return (
    <Animated.View style={[STYLES.grow, zoom]}>
      <View className={cn("flex-1 items-center justify-center", className)}>{children}</View>
    </Animated.View>
  );
}

export function CardFooter({ className, children }: CardPartProps) {
  return (
    <View className={cn("min-h-4 flex-row items-center justify-between", className)}>
      {children}
    </View>
  );
}

const ARROW_COLORS: Record<CardVariant, keyof Pick<ThemeColors, "iconMuted" | "background">> = {
  empty: "iconMuted",
  default: "iconMuted",
  success: "iconMuted",
  info: "iconMuted",
  pending: "iconMuted",
  alert: "background",
};

export function CardArrow({ className }: { className?: string }) {
  const { variant } = useCard();
  const t = useThemeColors();

  return (
    <View aria-hidden className={cn("ml-auto", className)}>
      <ArrowRight size={14} strokeWidth={2} color={t[ARROW_COLORS[variant]]} />
    </View>
  );
}
