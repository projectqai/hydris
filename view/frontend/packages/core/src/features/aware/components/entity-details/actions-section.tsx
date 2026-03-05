import { Code, ConnectError } from "@connectrpc/connect";
import { ControlButton } from "@hydris/ui/controls";
import type { Entity } from "@projectqai/proto/world";
import { Zap } from "lucide-react-native";
import { View } from "react-native";
import { toast } from "sonner-native";
import { useShallow } from "zustand/react/shallow";

import { useRunTask } from "../../../../lib/api/use-run-task";
import { useEntityStore } from "../../store/entity-store";
import { useSelectionStore } from "../../store/selection-store";

function getTaskableLabel(entity: Entity): string {
  return entity.label || entity.taskable?.label || entity.id;
}

function hasContextOrAssignee(entity: Entity, targetEntityId: string): boolean {
  if (!entity.taskable) return false;

  const hasContext = entity.taskable.context.some((c) => c.entityId === targetEntityId);
  const hasAssignee = entity.taskable.assignee.some((a) => a.entityId === targetEntityId);

  return hasContext || hasAssignee;
}

function TaskableButton({ taskable }: { taskable: Entity }) {
  const { runTask, isPending } = useRunTask();
  const label = getTaskableLabel(taskable);

  const handlePress = async () => {
    try {
      await runTask(taskable.id);
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        toast("Task already running");
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

  const taskables = useEntityStore(
    useShallow((s) => {
      if (!selectedEntityId) return [];

      const allEntities = Array.from(s.entities.values());
      const withTaskable = allEntities.filter((e) => e.taskable);
      const matching = withTaskable.filter((e) => hasContextOrAssignee(e, selectedEntityId));

      return matching;
    }),
  );

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
