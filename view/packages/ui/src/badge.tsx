import type { ComponentType, ReactNode } from "react";
import { Text, View } from "react-native";

import { cn } from "./lib/utils";

export type BadgeVariant =
  | "success"
  | "danger"
  | "warning"
  | "pending"
  | "neutral"
  | "info"
  | "affiliation-blue"
  | "affiliation-red"
  | "affiliation-neutral"
  | "affiliation-unknown";
export type BadgeSize = "sm" | "md" | "lg";

type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ComponentType<{ size: number; color: string }>;
  children: ReactNode;
};

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-success/20 border-success/40",
  danger: "bg-red/20 border-red/40",
  warning: "bg-warning/20 border-warning/40",
  pending: "bg-pending/20 border-pending/40",
  neutral: "bg-foreground/10 border-foreground/20",
  info: "bg-blue/20 border-blue/40",
  "affiliation-blue": "bg-milsymbol-friend/35 border-milsymbol-friend/55",
  "affiliation-red": "bg-milsymbol-hostile/35 border-milsymbol-hostile/55",
  "affiliation-neutral": "bg-milsymbol-neutral/35 border-milsymbol-neutral/55",
  "affiliation-unknown": "bg-milsymbol-unknown/35 border-milsymbol-unknown/55",
};

const textVariantStyles: Record<BadgeVariant, string> = {
  success: "text-success-foreground",
  danger: "text-red-foreground",
  warning: "text-warning",
  pending: "text-pending-foreground",
  neutral: "text-foreground/80",
  info: "text-blue-foreground",
  "affiliation-blue": "text-foreground",
  "affiliation-red": "text-foreground",
  "affiliation-neutral": "text-foreground",
  "affiliation-unknown": "text-foreground",
};

const sizeStyles: Record<BadgeSize, { container: string; text: string; icon: number }> = {
  sm: { container: "px-1.5 py-0.5 gap-1", text: "text-11", icon: 10 },
  md: { container: "px-2 py-1 gap-1.5", text: "text-xs", icon: 12 },
  lg: { container: "px-2.5 py-1.5 gap-2", text: "text-sm", icon: 14 },
};

export function Badge({ variant = "neutral", size = "md", icon: Icon, children }: BadgeProps) {
  const styles = sizeStyles[size];

  return (
    <View className="bg-background rounded-md">
      <View
        className={cn(
          "flex-row items-center justify-center rounded-md border",
          variantStyles[variant],
          styles.container,
        )}
      >
        {Icon && <Icon size={styles.icon} color="currentColor" />}
        <Text className={cn("font-sans-medium", styles.text, textVariantStyles[variant])}>
          {children}
        </Text>
      </View>
    </View>
  );
}
