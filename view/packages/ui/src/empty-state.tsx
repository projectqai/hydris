import type { PropsWithChildren } from "react";
import { createContext, use } from "react";
import { Text, View } from "react-native";

import type { CardIconComponent } from "./card";
import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";

type EmptyVariant = "default" | "small";

type EmptyPartProps = PropsWithChildren<{ className?: string }>;

const EmptyContext = createContext<EmptyVariant | null>(null);

function useEmpty() {
  const variant = use(EmptyContext);

  if (!variant) throw new Error("Empty parts must be rendered inside an Empty");

  return variant;
}

const EMPTY_STYLES: Record<EmptyVariant, string> = {
  default: "flex-1 items-center justify-center px-6 select-none",
  small: "items-center justify-center px-4 py-4 select-none",
};

export function Empty({
  variant = "default",
  className,
  children,
}: EmptyPartProps & { variant?: EmptyVariant }) {
  return (
    <EmptyContext value={variant}>
      <View className={cn(EMPTY_STYLES[variant], className)}>{children}</View>
    </EmptyContext>
  );
}

const MEDIA_STYLES: Record<EmptyVariant, { className: string; size: number }> = {
  default: { className: "mb-2", size: 28 },
  small: { className: "mb-1", size: 20 },
};

export function EmptyMedia({
  icon: Icon,
  color,
  className,
}: {
  icon: CardIconComponent;
  color?: string;
  className?: string;
}) {
  const t = useThemeColors();
  const { className: spacing, size } = MEDIA_STYLES[useEmpty()];

  return (
    <View className={cn(spacing, color === undefined && "opacity-60", className)}>
      <Icon size={size} color={color ?? t.iconActive} strokeWidth={1.5} />
    </View>
  );
}

const TITLE_STYLES: Record<EmptyVariant, string> = {
  default: "font-sans-medium text-foreground/70 text-center text-sm",
  small: "font-sans-medium text-foreground/70 text-center text-xs",
};

export function EmptyTitle({ className, children }: EmptyPartProps) {
  return <Text className={cn(TITLE_STYLES[useEmpty()], className)}>{children}</Text>;
}

const DESCRIPTION_STYLES: Record<EmptyVariant, string> = {
  default: "text-foreground/70 text-center font-sans text-xs leading-relaxed",
  small: "text-foreground/70 text-11 text-center font-sans leading-4",
};

export function EmptyDescription({ className, children }: EmptyPartProps) {
  return <Text className={cn(DESCRIPTION_STYLES[useEmpty()], className)}>{children}</Text>;
}

export function EmptyLink({
  onPress,
  className,
  children,
}: EmptyPartProps & { onPress: () => void }) {
  return (
    <Text
      role="link"
      onPress={onPress}
      className={cn("font-sans-medium text-foreground underline", className)}
    >
      {children}
    </Text>
  );
}

const CONTENT_STYLES: Record<EmptyVariant, string> = { default: "mt-3", small: "mt-2" };

export function EmptyContent({ className, children }: EmptyPartProps) {
  return <View className={cn(CONTENT_STYLES[useEmpty()], className)}>{children}</View>;
}
