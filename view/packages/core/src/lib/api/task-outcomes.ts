import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Entity } from "@projectqai/proto/world";
import { TaskExecutionState } from "@projectqai/proto/world";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { toast } from "../sonner";
import { timestampToMs } from "./use-track-utils";

type Run = {
  label: string;
  successToast?: string;
  // The entity's fresh before the run started. RunTask stamps a newer one, so
  // a result left from an earlier run is not taken for this one.
  since: number;
  seen: boolean;
};

const runs = new Map<string, Run>();
let unsubscribe: (() => void) | null = null;

// A run on its taskable gets a new fresh from RunTask. A spawned run gets only a from, at creation.
export function runFreshness(entity: Entity): number {
  return Math.max(timestampToMs(entity.lifetime?.fresh), timestampToMs(entity.lifetime?.from));
}

// A run is the requested one once it is fresher than its taskable was before the request
export function isFresherThan(entity: Entity, since: number) {
  return runFreshness(entity) > since;
}

function check() {
  const { entities } = useEntityStore.getState();

  for (const [id, run] of runs) {
    const entity = entities.get(id);

    // A spawned execution's entity may not have arrived yet.
    if (!entity) {
      if (run.seen) runs.delete(id);
      continue;
    }

    run.seen = true;
    const execution = entity.taskExecution;

    if (!execution || !isFresherThan(entity, run.since)) continue;

    if (execution.state === TaskExecutionState.TaskExecutionStateFailed) {
      const toastId = `task-${id}`;

      toast.error(run.label, {
        id: toastId,
        description: execution.reason,
        duration: Infinity,
        cancel: { label: "Dismiss", onClick: () => toast.dismiss(toastId) },
      });
      runs.delete(id);
    } else if (execution.state === TaskExecutionState.TaskExecutionStateCompleted) {
      toast.success(run.successToast ?? run.label, { description: execution.reason });
      runs.delete(id);
    }
  }

  if (runs.size === 0 && unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

export function toastOutcome(
  executionId: string,
  { label, since, successToast }: { label: string; since?: Timestamp; successToast?: string },
) {
  runs.set(executionId, { label, successToast, since: timestampToMs(since), seen: false });

  if (!unsubscribe) unsubscribe = useEntityStore.subscribe(check);

  check();
}
