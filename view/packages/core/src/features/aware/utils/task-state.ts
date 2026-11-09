import type { Entity } from "@projectqai/proto/world";
import { TaskExecutionState } from "@projectqai/proto/world";

export function isUnderway(
  state: TaskExecutionState | undefined,
): state is
  | TaskExecutionState.TaskExecutionStatePending
  | TaskExecutionState.TaskExecutionStateRunning {
  return (
    state === TaskExecutionState.TaskExecutionStatePending ||
    state === TaskExecutionState.TaskExecutionStateRunning
  );
}

export function isTaskRunning(taskable: Entity | null | undefined): boolean {
  return isUnderway(taskable?.taskExecution?.state);
}
