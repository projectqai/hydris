import * as Clipboard from "expo-clipboard";
import { Copy } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { toast } from "./lib/sonner";
import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";
import { MiddleTruncateText } from "./middle-truncate-text";

type InfoRowProps = {
  icon?: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  value: ReactNode;
  copyValue?: string;
  onCopy?: boolean;
  mono?: boolean;
  className?: string;
  /** Truncates a string value in the middle, keeping this many trailing characters whole. */
  tailLength?: number;
  /** Sits after the value and never shrinks, so the value truncates first. */
  trailing?: ReactNode;
};

export function InfoRow({
  icon: Icon,
  label,
  value,
  copyValue,
  onCopy,
  mono,
  className,
  tailLength,
  trailing,
}: InfoRowProps) {
  const t = useThemeColors();
  const handleCopy = async () => {
    if (!onCopy) return;
    const textToCopy = copyValue ?? (typeof value === "string" ? value : undefined);
    if (textToCopy) {
      await Clipboard.setStringAsync(textToCopy);
      toast.success("Copied to clipboard");
    }
  };

  const textClassName = cn("text-foreground/90 text-xs", mono ? "font-mono" : "font-sans-medium");

  return (
    <View className={cn("flex-row items-center gap-2 py-1.5", className)}>
      {Icon && (
        <View className="w-5 items-center">
          <Icon size={15} color={t.iconSubtle} strokeWidth={2} />
        </View>
      )}
      <View className="flex-1 flex-row items-center justify-between gap-2">
        <Text className="font-sans-medium text-foreground/75 text-xs">{label}</Text>
        <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1.5">
          {tailLength !== undefined && typeof value === "string" ? (
            <View className="min-w-0 shrink">
              <MiddleTruncateText text={value} tailLength={tailLength} className={textClassName} />
            </View>
          ) : (
            <Text numberOfLines={1} className={cn("shrink", textClassName)}>
              {value}
            </Text>
          )}
          {trailing && <View className="shrink-0 flex-row items-center gap-1.5">{trailing}</View>}
          {onCopy && (copyValue || typeof value === "string") && (
            <Pressable
              onPress={handleCopy}
              hitSlop={16}
              accessibilityLabel="Copy to clipboard"
              accessibilityRole="button"
              className="hover:opacity-70 active:opacity-50"
            >
              <Copy size={12} color={t.iconSubtle} strokeWidth={2} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
