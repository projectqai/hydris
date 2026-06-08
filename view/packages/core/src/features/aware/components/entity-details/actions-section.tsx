import { Code, ConnectError } from "@connectrpc/connect";
import { ControlButton } from "@hydris/ui/controls";
import type { Entity } from "@projectqai/proto/world";
import { Zap } from "lucide-react-native";
import { View } from "react-native";

import { useRunTask } from "../../../../lib/api/use-run-task";
import { toast } from "../../../../lib/sonner";
import { useEntityTaskables } from "../../hooks/use-entity-taskables";
import { useSelectionStore } from "../../store/selection-store";

function getTaskableLabel(entity: Entity): string {
  return entity.taskable?.label || entity.label || entity.id;
}

function TaskableButton({ taskable }: { taskable: Entity }) {
  const { runTask, isPending } = useRunTask();
  const label = getTaskableLabel(taskable);

  const handlePress = async () => {
    try {
      await runTask(taskable.id);
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        toast.warning("Task already running");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Task failed");
    }
  };

  return (
    <ControlButton
      onPress={handlePress}
      disabled={isPending}
      loading={isPending}
      icon={Zap}
      iconSize={14}
      iconStrokeWidth={2}
      label={label}
      labelClassName="text-xs leading-none"
      size="md"
      fullWidth
      accessibilityLabel={`Run ${label}`}
    />
  );
}

export function ActionsSection() {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const taskables = useEntityTaskables(selectedEntityId);

  if (!selectedEntityId) return null;
  if (taskables.length === 0) return null;

  return (
    <View className="gap-1.5">
      {taskables.map((taskable) => (
        <TaskableButton key={taskable.id} taskable={taskable} />
      ))}
    </View>
  );
}
