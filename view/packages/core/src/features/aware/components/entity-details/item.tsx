import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { MiddleTruncateText } from "@hydris/ui/middle-truncate-text";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function ItemMedia({ className, children }: { className?: string; children: ReactNode }) {
  const t = useThemeColors();

  return (
    <View
      className={cn(
        "h-7 w-10 shrink-0 items-center justify-center overflow-hidden rounded",
        className,
      )}
      style={{ backgroundColor: t.insetBg, boxShadow: t.insetShadow }}
    >
      {children}
    </View>
  );
}

export function ItemContent({ className, children }: { className?: string; children: ReactNode }) {
  return <View className={cn("min-w-0 flex-1", className)}>{children}</View>;
}

export function ItemTitle({ className, children }: { className?: string; children: string }) {
  return (
    <MiddleTruncateText
      text={children}
      tailLength={9}
      className={cn("text-foreground/90 font-mono text-xs tracking-wide uppercase", className)}
    />
  );
}

export function ItemDescription({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text
      className={cn(
        "text-foreground/65 text-10 mt-px font-mono tracking-wide uppercase",
        className,
      )}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}
