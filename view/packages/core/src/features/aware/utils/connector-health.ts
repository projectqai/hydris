import type { ConnectorHealth } from "@hydris/map-engine/types";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";

import { FAILED_CONFIGURABLE_STATES, RUNNING_CONFIGURABLE_STATES } from "./configurable-states";

function isConnector(entity: Entity): boolean {
  return !!(entity.configurable || entity.device);
}

export function deriveConnectorHealth(entity: Entity): ConnectorHealth | undefined {
  // a link on a plain asset is that asset's comms, not a connector
  if (!isConnector(entity)) return undefined;

  if (entity.link) {
    switch (entity.link.status) {
      case LinkStatus.LinkStatusConnected:
        return "healthy";
      case LinkStatus.LinkStatusDegraded:
        return "degraded";
      case LinkStatus.LinkStatusLost:
        return "failed";
    }
  }

  if (entity.device) {
    switch (entity.device.state) {
      case DeviceState.DeviceStateActive:
        return "healthy";
      case DeviceState.DeviceStateDegraded:
        return "degraded";
      case DeviceState.DeviceStatePending:
        return "degraded";
      case DeviceState.DeviceStateFailed:
        return "failed";
    }
  }

  if (entity.configurable) {
    const s = entity.configurable.state;
    if (RUNNING_CONFIGURABLE_STATES.has(s)) return "healthy";
    if (FAILED_CONFIGURABLE_STATES.has(s)) return "failed";
    if (s === ConfigurableState.ConfigurableStateStarting) return "degraded";
    return undefined; // Inactive / Unspecified: no badge
  }

  return undefined;
}
