import { useThemeColors } from "@hydris/ui/lib/theme";
import { StatusLabel } from "@hydris/ui/status-label";
import type { Entity } from "@projectqai/proto/world";
import { X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useCancelTask } from "../../../../lib/api/use-run-task";
import { formatTaskExecutionState } from "../../utils/format-entity";
import { isTaskRunning } from "../../utils/task-state";

// A finished run stays until someone clears it, which removes it in the engine for everyone
export function TaskExecutionRow({ run, label }: { run: Entity; label: string }) {
  const t = useThemeColors();
  const { cancel } = useCancelTask();
  const execution = run.taskExecution;

  if (!execution) return null;

  const state = formatTaskExecutionState(execution.state);

  return (
    <View className="flex-row items-center gap-2 px-3 py-1">
      <StatusLabel variant={`plain-${state.severity}`}>{state.label}</StatusLabel>
      <Text
        className="text-muted-foreground flex-1 font-sans text-xs leading-4"
        accessibilityLiveRegion="polite"
      >
        {execution.reason}
      </Text>
      {!isTaskRunning(run) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label} result`}
          hitSlop={8}
          onPress={() => cancel(run.id)}
          className="size-6 items-center justify-center rounded"
        >
          <X size={16} strokeWidth={2} color={t.iconMuted} />
        </Pressable>
      )}
    </View>
  );
}
