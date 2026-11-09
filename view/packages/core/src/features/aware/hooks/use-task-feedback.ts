import type { Entity } from "@projectqai/proto/world";
import { TaskExecutionState } from "@projectqai/proto/world";
import { useEffect, useState } from "react";

import { isFresherThan, runFreshness } from "../../../lib/api/task-outcomes";
import { useCancelTask } from "../../../lib/api/use-run-task";
import { DONE_SHOWN_MS } from "../utils/task-feedback";

// A failed run stays until someone dismisses it, which clears it in the engine for everyone.
// The local mark covers only the wait for the engine, so it lapses once that failure is gone.
export function useFailureDismissal(failure: string | undefined, executionId: string) {
  const { cancel } = useCancelTask();
  const [dismissed, setDismissed] = useState<string>();

  if (dismissed !== undefined && dismissed !== failure) setDismissed(undefined);

  const dismiss = async () => {
    if (failure === undefined) return;

    setDismissed(failure);

    if (!(await cancel(executionId))) setDismissed(undefined);
  };

  return { shown: failure !== undefined && failure !== dismissed, dismiss };
}

// "Done." shows only for a run that finishes while on screen, so an old success does not flash when
// the panel opens.
// The run's id and state decide it, because the engine refreshes an entity without a new result.
// The run must be the one shown before it finished, or a fresher one. Otherwise dismissing a failure
// would show an older success as new.
export function useLandedDone(run: Entity | undefined) {
  const state = run?.taskExecution?.state;
  const key = run === undefined ? undefined : `${run.id}\n${state}`;
  const id = run?.id;
  const fresh = run === undefined ? 0 : runFreshness(run);
  const [seen, setSeen] = useState({ key, id, fresh });
  const [shown, setShown] = useState<string>();

  if (key !== seen.key) {
    const landed =
      run !== undefined &&
      state === TaskExecutionState.TaskExecutionStateCompleted &&
      (run.id === seen.id || isFresherThan(run, seen.fresh));

    setSeen({ key, id, fresh });
    setShown(landed ? key : undefined);
  }

  useEffect(() => {
    if (shown === undefined) return;

    const timer = setTimeout(() => setShown(undefined), DONE_SHOWN_MS);

    return () => clearTimeout(timer);
  }, [shown]);

  return shown !== undefined;
}
