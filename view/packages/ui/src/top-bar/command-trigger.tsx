"use no memo";

import { Command } from "lucide-react-native";
import { Platform, Text, View } from "react-native";

import { ControlButton } from "../controls";
import { IS_MAC } from "../lib/platform";
import type { StateSeverity } from "../lib/severity";
import { SEVERITY_DOT } from "../lib/severity";
import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";
import type { StatusLabelVariant } from "../status-label";
import { StatusLabel } from "../status-label";

type BadgeSeverity = Extract<StateSeverity, "pending" | "alert">;

export type CommandTriggerStatus =
  | { severity: "success" }
  | { severity: BadgeSeverity; label: string };

const BADGE_STYLES: Record<BadgeSeverity, { pill: string; label: StatusLabelVariant }> = {
  pending: { pill: "bg-pending/15", label: "plain-pending" },
  alert: { pill: "bg-warning", label: "alert" },
};

export function CommandTrigger({
  onPress,
  status,
}: {
  onPress: () => void;
  status?: CommandTriggerStatus;
}) {
  const t = useThemeColors();
  const badge = status?.severity === "success" ? undefined : status;

  return (
    <ControlButton onPress={onPress}>
      {status?.severity === "success" && (
        <View aria-hidden className={cn(SEVERITY_DOT.success, "size-1.5 rounded-full")} />
      )}
      <Text className="font-sans-medium text-13 text-on-surface/75">Mission</Text>
      {badge && (
        <View className={cn("h-5 justify-center rounded", BADGE_STYLES[badge.severity].pill)}>
          <StatusLabel variant={BADGE_STYLES[badge.severity].label}>{badge.label}</StatusLabel>
        </View>
      )}
      {Platform.OS === "web" && !badge && (
        <View className="bg-surface-overlay/6 h-5 flex-row items-center justify-center gap-0.5 rounded px-1.5">
          {IS_MAC ? (
            <Command aria-hidden size={10} strokeWidth={2} color={t.iconSubtle} />
          ) : (
            <Text aria-hidden className="text-10 text-on-surface/70 font-mono leading-none">
              Ctrl
            </Text>
          )}
          <Text aria-hidden className="text-10 text-on-surface/70 font-mono leading-none">
            K
          </Text>
        </View>
      )}
    </ControlButton>
  );
}
