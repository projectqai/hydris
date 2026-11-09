import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { TaskableTargetMode } from "@projectqai/proto/tasking";
import type { Entity } from "@projectqai/proto/world";
import { TaskExecutionState } from "@projectqai/proto/world";

import { isUnderway } from "./task-state";

export type ModeOutcome =
  | {
      state:
        | TaskExecutionState.TaskExecutionStatePending
        | TaskExecutionState.TaskExecutionStateRunning;
      target: string;
      progress?: number;
      reason?: string;
    }
  | { state: TaskExecutionState.TaskExecutionStateFailed; target: string; reason?: string };

export type ModeRow = {
  id: string;
  title: string;
  description?: string;
  disabled: boolean;
  disabledReason?: string;
  expires?: { at: Timestamp; next?: string };
  outcome?: ModeOutcome;
};

type ModePickerState = {
  value?: string;
  pendingValue?: string;
  rows: ModeRow[];
};

function unofferedActiveRow(offered: ModeRow[], active: string | undefined): ModeRow | undefined {
  if (active === undefined || offered.some((row) => row.id === active)) return undefined;

  return { id: active, title: active, disabled: true };
}

function optionRows(mode: TaskableTargetMode | undefined): ModeRow[] {
  const offered: ModeRow[] = (mode?.options ?? []).map((option) => ({
    id: option.id,
    title: option.label || option.id,
    description: option.description || undefined,
    disabled: option.disabled !== undefined,
    disabledReason: option.disabled || undefined,
  }));

  const unoffered = unofferedActiveRow(offered, mode?.active);

  return unoffered ? [...offered, unoffered] : offered;
}

function requestedOption(taskable: Entity): string | undefined {
  const kind = taskable.taskExecution?.target?.kind;

  return kind?.case === "mode" ? kind.value : undefined;
}

function placeOutcome(taskable: Entity): ModeOutcome | undefined {
  const execution = taskable.taskExecution;
  const target = requestedOption(taskable);

  if (!execution || target === undefined) return undefined;

  const { state } = execution;

  if (state === TaskExecutionState.TaskExecutionStateFailed) {
    return { state, target, reason: execution.reason };
  }

  if (!isUnderway(state)) return undefined;

  return { state, target, progress: execution.progress, reason: execution.reason };
}

export function deriveModePicker(taskable: Entity, inFlightRequest?: string): ModePickerState {
  const mode = taskable.taskable?.target?.mode;
  const active = mode?.active;
  const rows = optionRows(mode);
  const outcome = placeOutcome(taskable);
  const titleOf = (id: string) => rows.find((row) => row.id === id)?.title ?? id;

  const expires = mode?.until && {
    at: mode.until,
    next: mode.next === undefined ? undefined : titleOf(mode.next),
  };

  return {
    value: active,
    pendingValue: inFlightRequest ?? (isUnderway(outcome?.state) ? outcome?.target : undefined),
    rows: rows.map((row) => ({
      ...row,
      expires: row.id === active ? expires : undefined,
      outcome: row.id === outcome?.target ? outcome : undefined,
    })),
  };
}
