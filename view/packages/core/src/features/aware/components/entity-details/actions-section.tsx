import { FieldContent, FieldDescription, FieldError, FieldTitle } from "@hydris/ui/field";
import {
  HoldButton,
  HoldButtonContent,
  HoldButtonIcon,
  HoldButtonLock,
  HoldButtonProgress,
  type HoldButtonStatus,
} from "@hydris/ui/hold-button";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { TaskExecutionState } from "@projectqai/proto/world";
import { useState } from "react";
import { View } from "react-native";

import { useRunTaskable } from "../../../../lib/api/use-run-task";
import { getTaskableLabel, timestampToMs } from "../../../../lib/api/use-track-utils";
import { useNowUntil } from "../../../../lib/use-now-until";
import {
  entityTarget,
  useModeTaskables,
  useTaskExecutions,
} from "../../hooks/use-entity-taskables";
import { useFailureDismissal, useLandedDone } from "../../hooks/use-task-feedback";
import { getTaskableIcon } from "../../utils/entity-helpers";
import { formatTaskExecutionState } from "../../utils/format-entity";
import { RUN_TEXT } from "../../utils/task-feedback";
import { isTaskRunning } from "../../utils/task-state";
import { ModePicker } from "../mode-picker/mode-picker";
import { TaskExecutionRow } from "./task-execution-row";

function buttonStatus(
  underway: boolean,
  cancellable: boolean,
  failed: boolean,
  done: boolean,
): HoldButtonStatus {
  if (underway) return cancellable ? "running" : "busy";

  if (failed) return "failed";

  return done ? "done" : "idle";
}

// A spawned run starts with its own entity, so its lifetime spans the run. An own run's
// lifetime is the taskable's.
function runProgress(run: Entity, spawned: boolean, now: number): number | undefined {
  const execution = run.taskExecution;

  if (execution?.progress !== undefined) return execution.progress;

  if (!spawned || !execution?.eta || !run.lifetime?.from) return undefined;

  const from = timestampToMs(run.lifetime.from);
  const eta = timestampToMs(execution.eta);

  return eta > from ? Math.round(((now - from) / (eta - from)) * 100) : 100;
}

function RunProgress({ run, spawned, label }: { run: Entity; spawned: boolean; label: string }) {
  const execution = run.taskExecution;
  const counting = spawned && execution?.progress === undefined;
  const now = useNowUntil(counting ? timestampToMs(execution?.eta) : undefined);
  const value = runProgress(run, spawned, now);

  if (value === undefined) return null;

  return <HoldButtonProgress value={value} accessibilityLabel={`${label} progress`} />;
}

function underwayText(run: Entity | undefined, waiting: boolean, cancelling: boolean) {
  if (cancelling) return RUN_TEXT.cancelling;

  if (waiting) return RUN_TEXT.cancel;

  const running = formatTaskExecutionState(TaskExecutionState.TaskExecutionStateRunning).label;

  return run?.taskExecution?.reason || running;
}

function describe(
  status: HoldButtonStatus,
  taskable: Entity,
  run: Entity | undefined,
  refusal: string | undefined,
  underway: string,
) {
  if (status === "idle") return taskable.taskable?.disabled ?? taskable.taskable?.effect;

  if (status === "running" || status === "busy") return underway;

  if (status === "done") return RUN_TEXT.done;

  const reason = refusal ?? run?.taskExecution?.reason;

  return reason || formatTaskExecutionState(TaskExecutionState.TaskExecutionStateFailed).label;
}

function TaskableButton({ taskable, entityId }: { taskable: Entity; entityId: string }) {
  const label = getTaskableLabel(taskable);
  const unavailable = taskable.taskable?.disabled;
  const [run, ...earlier] = useTaskExecutions(taskable.id);
  const running = isTaskRunning(run);

  const {
    run: requestRun,
    isStarting,
    cancel,
    cancelling,
  } = useRunTaskable({ underway: running ? run?.id : undefined });

  const failedRun =
    run?.taskExecution?.state === TaskExecutionState.TaskExecutionStateFailed ? run : undefined;

  const done = useLandedDone(run);
  const failure = useFailureDismissal(failedRun?.id, failedRun?.id ?? taskable.id);
  const [refusedTap, setRefusedTap] = useState(false);

  const refusedReason = refusedTap ? unavailable : undefined;
  const refused = refusedReason !== undefined;

  // A request still on its way counts as waiting to start, since its run has not arrived yet
  const waiting =
    (isStarting && !running) ||
    run?.taskExecution?.state === TaskExecutionState.TaskExecutionStatePending;

  const cancellable = (waiting || running) && !cancelling;

  const status = buttonStatus(isStarting || running, cancellable, refused || failure.shown, done);

  const underway = underwayText(run, waiting, cancelling);
  const description = describe(status, taskable, run, refusedReason, underway);

  const dismiss = () => {
    if (refused) setRefusedTap(false);
    else failure.dismiss();
  };

  const button = (
    <HoldButton
      status={status}
      disabled={unavailable !== undefined}
      onConfirm={() => requestRun(taskable.id, entityTarget(taskable, entityId))}
      onCancel={cancel}
      onDismiss={dismiss}
      onRefuse={() => setRefusedTap(true)}
    >
      <HoldButtonContent>
        <FieldContent>
          <View className="flex-row items-center gap-1.5">
            <HoldButtonIcon icon={getTaskableIcon(taskable)} />
            <FieldTitle>
              {label}
              <HoldButtonLock />
            </FieldTitle>
          </View>
          {status === "failed" ? (
            <FieldError accessibilityLiveRegion="polite">{description}</FieldError>
          ) : (
            description && (
              <FieldDescription accessibilityLiveRegion="polite">{description}</FieldDescription>
            )
          )}
        </FieldContent>
      </HoldButtonContent>
      {running && run && <RunProgress run={run} spawned={run.id !== taskable.id} label={label} />}
    </HoldButton>
  );

  if (earlier.length === 0) return button;

  return (
    <View className="gap-1.5">
      {button}
      {earlier.map((other) => (
        <TaskExecutionRow key={other.id} run={other} label={label} />
      ))}
    </View>
  );
}

// The caller picks which plain taskables belong here. The entity's mode switches always show as
// pickers, so no screen can list one as a plain button.
export function ActionsSection({
  entityId,
  taskables,
  className,
}: {
  entityId: string;
  taskables: Entity[];
  className?: string;
}) {
  const modeTaskables = useModeTaskables(entityId);

  if (taskables.length === 0 && modeTaskables.length === 0) return null;

  return (
    <View className={cn("gap-4", className)}>
      {modeTaskables.map((taskable) => (
        <ModePicker key={taskable.id} taskable={taskable} />
      ))}
      {taskables.length > 0 && (
        <View className="gap-4">
          {taskables.map((taskable) => (
            <TaskableButton key={taskable.id} taskable={taskable} entityId={entityId} />
          ))}
        </View>
      )}
    </View>
  );
}
