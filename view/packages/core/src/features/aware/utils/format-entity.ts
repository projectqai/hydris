import type { StateSeverity } from "@hydris/ui/lib/severity";
import { SEVERITY_TEXT } from "@hydris/ui/lib/severity";
import { AlertLevel } from "@projectqai/proto/metrics";
import {
  ConfigurableState,
  DeviceState,
  LinkStatus,
  TaskExecutionState,
} from "@projectqai/proto/world";

import { formatCompactDuration } from "./format-metrics";

type StateReading = { label: string; severity: StateSeverity };

const UNKNOWN_STATE: StateReading = { label: "Unknown", severity: "neutral" };

const CONFIGURABLE_STATES: Record<ConfigurableState, StateReading> = {
  [ConfigurableState.ConfigurableStateActive]: { label: "Active", severity: "success" },
  [ConfigurableState.ConfigurableStateScheduled]: { label: "Scheduled", severity: "success" },
  [ConfigurableState.ConfigurableStateStarting]: { label: "Starting", severity: "pending" },
  [ConfigurableState.ConfigurableStateFailed]: { label: "Failed", severity: "alert" },
  [ConfigurableState.ConfigurableStateConflict]: { label: "Conflict", severity: "alert" },
  [ConfigurableState.ConfigurableStateInactive]: { label: "Inactive", severity: "neutral" },
};

const DEVICE_STATES: Record<DeviceState, StateReading> = {
  [DeviceState.DeviceStateActive]: { label: "Active", severity: "success" },
  [DeviceState.DeviceStatePending]: { label: "Pending", severity: "pending" },
  [DeviceState.DeviceStateDegraded]: { label: "Degraded", severity: "pending" },
  [DeviceState.DeviceStateFailed]: { label: "Failed", severity: "alert" },
};

const LINK_STATUSES: Partial<Record<LinkStatus, StateReading>> = {
  [LinkStatus.LinkStatusConnected]: { label: "Connected", severity: "success" },
  [LinkStatus.LinkStatusDegraded]: { label: "Degraded", severity: "pending" },
  [LinkStatus.LinkStatusLost]: { label: "Lost", severity: "alert" },
};

const TASK_EXECUTION_STATES: Record<TaskExecutionState, StateReading> = {
  [TaskExecutionState.TaskExecutionStatePending]: { label: "Pending", severity: "neutral" },
  [TaskExecutionState.TaskExecutionStateRunning]: { label: "Running", severity: "pending" },
  [TaskExecutionState.TaskExecutionStateCompleted]: { label: "Done", severity: "success" },
  [TaskExecutionState.TaskExecutionStateFailed]: { label: "Failed", severity: "alert" },
};

const METRIC_ALERTS: Partial<Record<AlertLevel, StateReading>> = {
  [AlertLevel.AlertLevelWarning]: { label: "Warning", severity: "pending" },
  [AlertLevel.AlertLevelAlarm]: { label: "Alarm", severity: "alert" },
  [AlertLevel.AlertLevelCritical]: { label: "Critical", severity: "alert" },
};

function format(reading: StateReading | undefined) {
  const { label, severity } = reading ?? UNKNOWN_STATE;

  return { label, severity, className: SEVERITY_TEXT[severity] };
}

export function formatMetricAlert(level: AlertLevel | undefined) {
  const reading = level === undefined ? undefined : METRIC_ALERTS[level];

  return reading ? format(reading) : null;
}

export function formatConfigurableState(state: ConfigurableState) {
  return format(CONFIGURABLE_STATES[state]);
}

export function formatDeviceState(state?: DeviceState) {
  return format(state === undefined ? undefined : DEVICE_STATES[state]);
}

export function formatTaskExecutionState(state: TaskExecutionState) {
  return format(TASK_EXECUTION_STATES[state]);
}

export function formatLinkStatus(status?: LinkStatus) {
  return format(status === undefined ? undefined : LINK_STATUSES[status]);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatUntil(untilMs: number, nowMs: number, clock: () => string): string {
  const left = untilMs - nowMs;

  if (left >= DAY_MS) return clock();

  return formatCompactDuration(Math.max(0, Math.floor(left / 1000)));
}
