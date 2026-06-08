import type { TaskExecutionTarget } from "@projectqai/proto/tasking";
import { TaskStatus } from "@projectqai/proto/world";
import { useState } from "react";

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
