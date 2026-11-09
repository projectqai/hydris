import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { FieldContent, FieldDescription, FieldError, FieldTitle } from "@hydris/ui/field";
import {
  Picker,
  PickerItem,
  PickerItemContent,
  PickerItemLock,
  PickerItemProgress,
} from "@hydris/ui/picker";
import { TaskExecutionTargetSchema } from "@projectqai/proto/tasking";
import type { Entity } from "@projectqai/proto/world";
import { TaskExecutionState } from "@projectqai/proto/world";
import { useState } from "react";
import { Text, View } from "react-native";

import { useRunTaskable } from "../../../../lib/api/use-run-task";
import { formatTime, getTaskableLabel, timestampToMs } from "../../../../lib/api/use-track-utils";
import { useNowUntil } from "../../../../lib/use-now-until";
import { useFailureDismissal } from "../../hooks/use-task-feedback";
import { formatTaskExecutionState, formatUntil } from "../../utils/format-entity";
import type { ModeOutcome, ModeRow } from "../../utils/mode-picker-state";
import { deriveModePicker } from "../../utils/mode-picker-state";
import { RUN_TEXT } from "../../utils/task-feedback";
import { isTaskRunning } from "../../utils/task-state";

type Failure = Extract<ModeOutcome, { state: TaskExecutionState.TaskExecutionStateFailed }>;

// A failed switch stays until someone dismisses it, which clears it in the engine for everyone.
// A refused tap exists only on this screen.
type Notice = {
  kind: "failure" | "refusal";
  row: string;
  label: string;
  reason?: string;
  key: string;
};

function TimeLeft({ until }: { until: Timestamp }) {
  const untilMs = timestampToMs(until);
  const now = useNowUntil(untilMs);

  return formatUntil(untilMs, now, () => formatTime(until));
}

function failure(outcome: ModeOutcome | undefined): Failure | undefined {
  return outcome?.state === TaskExecutionState.TaskExecutionStateFailed ? outcome : undefined;
}

function failureNotice(rows: ModeRow[], requestedAt: number): Notice | undefined {
  for (const row of rows) {
    const failed = failure(row.outcome);

    if (failed) {
      const { label } = formatTaskExecutionState(failed.state);
      const key = `${failed.target}\n${failed.reason ?? ""}\n${requestedAt}`;

      return { kind: "failure", row: row.id, label, reason: failed.reason, key };
    }
  }

  return undefined;
}

function refusalNotice(rows: ModeRow[], refused: string | undefined): Notice | undefined {
  const row = rows.find((candidate) => candidate.id === refused && candidate.disabled);

  if (!row) return undefined;

  return {
    kind: "refusal",
    row: row.id,
    label: "Refused",
    reason: row.disabledReason,
    key: `refused\n${row.id}`,
  };
}

function runningText(row: ModeRow) {
  const { outcome } = row;
  const running = formatTaskExecutionState(TaskExecutionState.TaskExecutionStateRunning).label;

  return (
    (outcome?.state !== TaskExecutionState.TaskExecutionStateFailed && outcome?.reason) || running
  );
}

function RowDescription({
  row,
  notice,
  pending,
  waiting,
  cancelling,
}: {
  row: ModeRow;
  notice: Notice | undefined;
  pending: boolean;
  waiting: boolean;
  cancelling: boolean;
}) {
  if (notice) {
    return (
      <FieldError accessibilityLiveRegion="polite">{notice.reason || notice.label}</FieldError>
    );
  }

  if (cancelling) return <FieldDescription>{RUN_TEXT.cancelling}</FieldDescription>;

  if (pending) {
    return <FieldDescription>{waiting ? RUN_TEXT.cancel : runningText(row)}</FieldDescription>;
  }

  return row.description ? <FieldDescription>{row.description}</FieldDescription> : null;
}

function switchProgress(row: ModeRow) {
  const { outcome } = row;

  if (outcome === undefined || outcome.state === TaskExecutionState.TaskExecutionStateFailed) {
    return undefined;
  }

  return outcome.progress;
}

export function ModePicker({ taskable }: { taskable: Entity }) {
  const { run, isStarting, cancel, cancelling } = useRunTaskable({
    underway: isTaskRunning(taskable) ? taskable.id : undefined,
  });

  const [requested, setRequested] = useState<string>();
  const label = getTaskableLabel(taskable);
  const disabledReason = taskable.taskable?.disabled;
  const picker = deriveModePicker(taskable, isStarting ? requested : undefined);

  const { rows } = picker;
  const [refusedRow, setRefusedRow] = useState<string>();
  const failed = failureNotice(rows, timestampToMs(taskable.lifetime?.fresh));
  const failure = useFailureDismissal(failed?.key, taskable.id);
  const refused = refusalNotice(rows, refusedRow);
  const notice = refused ?? (failure.shown ? failed : undefined);
  const cancellingRow = cancelling ? picker.pendingValue : undefined;
  const pendingOutcome = rows.find((row) => row.id === picker.pendingValue)?.outcome;

  // A switch still on its way has no run yet, so it counts as waiting to start
  const waiting =
    isStarting || pendingOutcome?.state === TaskExecutionState.TaskExecutionStatePending;

  const cancellable = picker.pendingValue !== undefined && !cancelling;

  const dismissNotice = () => {
    if (notice?.kind === "refusal") setRefusedRow(undefined);
    else failure.dismiss();
  };

  const request = (option: string) => {
    setRequested(option);
    setRefusedRow(undefined);
    run(taskable.id, create(TaskExecutionTargetSchema, { kind: { case: "mode", value: option } }));
  };

  return (
    <View className="gap-1">
      <Text className="text-foreground/75 text-11 font-mono tracking-widest uppercase">
        {label}
      </Text>
      {disabledReason && <FieldDescription>{disabledReason}</FieldDescription>}
      <Picker
        value={picker.value}
        pendingValue={picker.pendingValue}
        invalidValue={notice?.row}
        onValueChange={request}
        onDismissInvalid={dismissNotice}
        onRefusedChange={setRefusedRow}
        onCancel={cancellable ? cancel : undefined}
        disabled={disabledReason !== undefined}
        accessibilityLabel={label}
      >
        {rows.map((row) => {
          const progress = switchProgress(row);
          const shownNotice = row.id === notice?.row ? notice : undefined;

          return (
            <PickerItem key={row.id} value={row.id} disabled={row.disabled}>
              <PickerItemContent>
                <FieldContent>
                  <FieldTitle>
                    {row.title}
                    <PickerItemLock />
                  </FieldTitle>
                  <RowDescription
                    row={row}
                    notice={shownNotice}
                    pending={row.id === picker.pendingValue}
                    waiting={waiting}
                    cancelling={row.id === cancellingRow}
                  />
                  {row.expires && (
                    <FieldDescription>
                      <TimeLeft until={row.expires.at} />
                      {row.expires.next !== undefined && ` → ${row.expires.next}`}
                    </FieldDescription>
                  )}
                </FieldContent>
              </PickerItemContent>
              {!shownNotice && progress !== undefined && (
                <PickerItemProgress value={progress} accessibilityLabel={`${row.title} progress`} />
              )}
            </PickerItem>
          );
        })}
      </Picker>
    </View>
  );
}
