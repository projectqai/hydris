import { ConfigurableState } from "@projectqai/proto/world";

export const FAILED_CONFIGURABLE_STATES: ReadonlySet<ConfigurableState> = new Set([
  ConfigurableState.ConfigurableStateFailed,
  ConfigurableState.ConfigurableStateConflict,
]);

export const RUNNING_CONFIGURABLE_STATES: ReadonlySet<ConfigurableState> = new Set([
  ConfigurableState.ConfigurableStateActive,
  ConfigurableState.ConfigurableStateScheduled,
]);
