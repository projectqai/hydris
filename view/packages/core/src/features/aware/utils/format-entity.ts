import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";

export function formatConfigurableState(state: ConfigurableState) {
  switch (state) {
    case ConfigurableState.ConfigurableStateActive:
      return { label: "Active", className: "text-success-foreground" };
    case ConfigurableState.ConfigurableStateScheduled:
      return { label: "Scheduled", className: "text-success-foreground" };
    case ConfigurableState.ConfigurableStateStarting:
      return { label: "Starting", className: "text-pending-foreground" };
    case ConfigurableState.ConfigurableStateFailed:
      return { label: "Failed", className: "text-red-foreground" };
    case ConfigurableState.ConfigurableStateConflict:
      return { label: "Conflict", className: "text-red-foreground" };
    case ConfigurableState.ConfigurableStateInactive:
      return { label: "Inactive", className: "text-muted-foreground" };
    default:
      return { label: "Unknown", className: "text-muted-foreground" };
  }
}

export function formatDeviceState(state: DeviceState) {
  switch (state) {
    case DeviceState.DeviceStateActive:
      return { label: "Active", className: "text-success-foreground" };
    case DeviceState.DeviceStatePending:
      return { label: "Pending", className: "text-pending-foreground" };
    case DeviceState.DeviceStateDegraded:
      return { label: "Degraded", className: "text-pending-foreground" };
    case DeviceState.DeviceStateFailed:
      return { label: "Failed", className: "text-red-foreground" };
    default:
      return { label: "Unknown", className: "text-muted-foreground" };
  }
}

export function formatLinkStatus(status?: LinkStatus) {
  switch (status) {
    case LinkStatus.LinkStatusConnected:
      return { label: "Connected", className: "text-success-foreground" };
    case LinkStatus.LinkStatusDegraded:
      return { label: "Degraded", className: "text-pending-foreground" };
    case LinkStatus.LinkStatusLost:
      return { label: "Lost", className: "text-red-foreground" };
    default:
      return { label: "Unknown", className: "text-muted-foreground" };
  }
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
