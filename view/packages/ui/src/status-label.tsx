import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { SEVERITY_DOT, SEVERITY_TEXT } from "./lib/severity";
import { cn } from "./lib/utils";

export type StatusLabelVariant =
  | "neutral"
  | "info"
  | "success"
  | "pending"
  | "alert"
  | "plain-neutral"
  | "plain-success"
  | "plain-pending"
  | "plain-alert";

const VARIANT_STYLES: Record<StatusLabelVariant, { dot: string; label: string }> = {
  neutral: { dot: "bg-muted-foreground", label: "text-foreground" },
  info: { dot: "bg-blue", label: "text-foreground" },
  success: { dot: "bg-green", label: "text-foreground" },
  pending: { dot: "bg-pending-foreground", label: "text-foreground" },
  alert: { dot: "bg-background", label: "text-background" },
  "plain-neutral": { dot: SEVERITY_DOT.neutral, label: SEVERITY_TEXT.neutral },
  "plain-success": { dot: SEVERITY_DOT.success, label: SEVERITY_TEXT.success },
  "plain-pending": { dot: SEVERITY_DOT.pending, label: SEVERITY_TEXT.pending },
  "plain-alert": { dot: SEVERITY_DOT.alert, label: SEVERITY_TEXT.alert },
};

export function StatusLabel({
  variant = "neutral",
  className,
  children,
}: {
  variant?: StatusLabelVariant;
  className?: string;
  children: ReactNode;
}) {
  const styles = VARIANT_STYLES[variant];

  return (
    <View className={cn("min-w-0 shrink flex-row items-center gap-1.5 px-1.5 py-0.5", className)}>
      <View className={cn("size-[5px] rounded-full", styles.dot)} />
      <Text className={cn("font-sans-medium text-11 shrink leading-none", styles.label)}>
        {children}
      </Text>
    </View>
  );
}
