import { Code, ConnectError } from "@connectrpc/connect";
import type { TaskExecutionTarget } from "@projectqai/proto/tasking";
import { TaskStatus } from "@projectqai/proto/world";
import { useState } from "react";

import { toast } from "../sonner";
import { worldClient } from "./world-client";

export function useRunTask() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const runTask = async (entityId: string, target?: TaskExecutionTarget) => {
    setIsPending(true);
    setError(null);

    try {
      const response = await worldClient.runTask({ entityId, target });

      if (response.status === TaskStatus.TaskStatusFailed) {
        throw new Error(response.humanReadableReason || "Task failed");
      }

      if (response.status === TaskStatus.TaskStatusInvalid) {
        throw new Error("Invalid task request");
      }

      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  return { runTask, isPending, error };
}

// runs a taskable and surfaces the standard task toasts (already-running vs failed).
export function useRunTaskable() {
  const { runTask, isPending } = useRunTask();

  const run = async (taskableId: string, target?: TaskExecutionTarget) => {
    try {
      await runTask(taskableId, target);
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        toast.warning("Task already running");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Task failed");
    }
  };

  return { run, isPending };
}
