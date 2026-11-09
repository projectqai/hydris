import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { ConfigurableComponent } from "@projectqai/proto/world";
import { ActivityIndicator, Text, View } from "react-native";

import { formatConfigurableState } from "../utils/format-entity";

export function WaitingForApply({
  overdue,
  configurable,
  className,
}: {
  overdue: boolean;
  configurable: ConfigurableComponent | undefined;
  className?: string;
}) {
  const t = useThemeColors();

  if (!overdue || !configurable) return null;

  const {
    label,
    severity,
    className: stateClassName,
  } = formatConfigurableState(configurable.state);

  if (severity === "alert") return null;

  return (
    <View className={cn("flex-row items-center gap-2", className)}>
      <View aria-hidden>
        <ActivityIndicator size={14} color={t.iconMuted} />
      </View>
      <Text className="text-muted-foreground shrink font-mono text-xs">
        Waiting for the device to apply your settings{" "}
        <Text className={stateClassName}>({label})</Text>
      </Text>
    </View>
  );
}
