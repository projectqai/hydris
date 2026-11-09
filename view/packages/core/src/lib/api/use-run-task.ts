import { Code, ConnectError } from "@connectrpc/connect";
import type { TaskExecutionTarget } from "@projectqai/proto/tasking";
import { TaskStatus } from "@projectqai/proto/world";
import { useRef, useState } from "react";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { toast } from "../sonner";
import { isFresherThan, toastOutcome } from "./task-outcomes";
import { getTaskableLabel, timestampToMs } from "./use-track-utils";
import { worldClient } from "./world-client";

export function useRunTask({ successToast }: { successToast?: string } = {}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const runTask = async (entityId: string, target?: TaskExecutionTarget) => {
    setIsPending(true);
    setError(null);

    const taskable = useEntityStore.getState().entities.get(entityId);

    try {
      const response = await worldClient.runTask({ entityId, target });

      if (response.status === TaskStatus.TaskStatusFailed) {
        throw new Error(response.humanReadableReason || "Task failed");
      }

      if (response.status === TaskStatus.TaskStatusInvalid) {
        throw new Error(response.humanReadableReason || "Invalid task request");
      }

      toastOutcome(response.executionId || entityId, {
        label: taskable ? getTaskableLabel(taskable) : entityId,
        since: taskable?.lifetime?.fresh,
        successToast,
      });

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

// The server's own message, without the status code prefix the client adds
function errorMessage(err: unknown) {
  if (err instanceof ConnectError) return err.rawMessage;

  return err instanceof Error ? err.message : "";
}

type StartedRun = { executionId: string; since: number };

// The request returns before its run reaches the store, so the run is awaited until it arrives.
// A run that shows up and is removed later, e.g. cleared by an operator or dropped by the engine
// to make room for newer runs, is not awaited forever.
function useAwaitingRun(started: StartedRun | undefined) {
  const [seen, setSeen] = useState<StartedRun>();

  const run = useEntityStore((s) => {
    if (started === undefined) return "none";

    const entity = s.entities.get(started.executionId);

    if (!entity) return "missing";

    return isFresherThan(entity, started.since) ? "arrived" : "stale";
  });

  if (run !== "none" && run !== "missing" && seen !== started) setSeen(started);

  return run === "stale" || (run === "missing" && seen !== started);
}

type Cancel =
  // Tapped while the request is on its way, so it waits for the run's id
  | { phase: "held" }
  | { phase: "sent"; executionId: string }
  // Accepted before the run reached the store. The run can still arrive, ended, until the engine
  // drops it, and must not offer cancel again then.
  | { phase: "accepted"; executionId: string };

// `underway` is the run the control shows underway. A cancel goes to it once this screen's own
// request has reached the store, and to the requested run before that.
export function useRunTaskable(options?: { successToast?: string; underway?: string }) {
  const { runTask, isPending } = useRunTask(options);
  const { cancel: cancelTask } = useCancelTask();
  const [started, setStarted] = useState<StartedRun>();
  const [cancel, setCancel] = useState<Cancel>();
  // Resolves with the run's id once the engine has the run, or undefined if the request failed
  const request = useRef<Promise<string | undefined>>(undefined);
  const awaiting = useAwaitingRun(started);
  const cancelTarget = awaiting ? started?.executionId : options?.underway;

  const aimed =
    cancel !== undefined && cancel.phase !== "held" && cancel.executionId === cancelTarget;

  const current = cancel?.phase === "held" || aimed ? cancel : undefined;

  if (cancel?.phase === "sent" && current === undefined) setCancel(undefined);

  const start = async (taskableId: string, target: TaskExecutionTarget | undefined) => {
    const taskable = useEntityStore.getState().entities.get(taskableId);
    const since = timestampToMs(taskable?.lifetime?.fresh);

    try {
      const response = await runTask(taskableId, target);
      const executionId = response.executionId || taskableId;

      setStarted({ executionId, since });

      return executionId;
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        toast.warning(errorMessage(err));
      } else {
        toast.error(errorMessage(err) || "Task failed");
      }

      return undefined;
    }
  };

  const run = async (taskableId: string, target?: TaskExecutionTarget) => {
    setCancel(undefined);
    request.current = start(taskableId, target);
    await request.current;
  };

  const send = async (executionId: string) => {
    setCancel({ phase: "sent", executionId });

    if (!(await cancelTask(executionId))) {
      setCancel(undefined);

      return;
    }

    if (!useEntityStore.getState().entities.has(executionId)) {
      setCancel({ phase: "accepted", executionId });
    }

    // A run cancelled before it reached the store arrives already ended, or not at all
    setStarted((previous) => (previous?.executionId === executionId ? undefined : previous));
  };

  const requestCancel = async () => {
    if (current !== undefined) return;

    if (!isPending) {
      if (cancelTarget !== undefined) await send(cancelTarget);

      return;
    }

    setCancel({ phase: "held" });

    const executionId = await request.current;

    if (executionId === undefined) setCancel(undefined);
    else await send(executionId);
  };

  return {
    run,
    isPending,
    // True from the request until its run arrives, so the control stays underway instead of at rest
    isStarting: isPending || awaiting,
    cancel: requestCancel,
    cancelling: current !== undefined,
  };
}

export function useCancelTask() {
  const cancel = async (executionId: string) => {
    try {
      await worldClient.cancelTask({ executionId });

      return true;
    } catch (err) {
      toast.error(errorMessage(err) || "Cancel failed");

      return false;
    }
  };

  return { cancel };
}
