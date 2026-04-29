import * as Clipboard from "expo-clipboard";
import { Copy } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { toast } from "./lib/sonner";
import { useThemeColors } from "./lib/theme";
import { cn } from "./lib/utils";

type InfoRowProps = {
  icon?: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  value: ReactNode;
  copyValue?: string;
  onCopy?: boolean;
  mono?: boolean;
  className?: string;
};

export function InfoRow({
  icon: Icon,
  label,
  value,
  copyValue,
  onCopy,
  mono,
  className,
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
          <Text
            numberOfLines={1}
            className={cn(
              "text-foreground/90 shrink text-xs",
              mono ? "font-mono" : "font-sans-medium",
            )}
          >
            {typeof value === "string" || typeof value === "number" ? value : value}
          </Text>
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
