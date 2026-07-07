import type { Entity } from "@projectqai/proto/world";
import { DeviceState, LinkStatus } from "@projectqai/proto/world";

import { formatDeviceState, formatLinkStatus } from "./format-entity";

export type ReadinessGateKey = "position" | "device" | "link";

export type ReadinessGateStatus = "met" | "failed" | "degraded" | "pending" | "blocked" | "unmet";

export interface ReadinessGate {
  key: ReadinessGateKey;
  status: ReadinessGateStatus;
}

export interface AssetReadiness {
  gates: ReadinessGate[];
  ready: boolean;
  failed: boolean;
}

function deviceGateStatus(entity: Entity): ReadinessGateStatus {
  switch (entity.device?.state) {
    case DeviceState.DeviceStateActive:
      return "met";
    case DeviceState.DeviceStateDegraded:
      return "degraded";
    case DeviceState.DeviceStateFailed:
      return "failed";
    case DeviceState.DeviceStatePending:
      return "pending";
    default:
      return "unmet";
  }
}

function linkGateStatus(status: LinkStatus | undefined): ReadinessGateStatus {
  switch (status) {
    case LinkStatus.LinkStatusConnected:
      return "met";
    case LinkStatus.LinkStatusDegraded:
      return "degraded";
    case LinkStatus.LinkStatusLost:
      return "failed";
    default:
      return "unmet";
  }
}

export function deriveAssetReadiness(entity: Entity): AssetReadiness {
  const gates: ReadinessGate[] = [{ key: "position", status: entity.geo ? "met" : "unmet" }];

  let deviceStatus: ReadinessGateStatus | undefined;
  if (entity.device) {
    deviceStatus = deviceGateStatus(entity);
    gates.push({ key: "device", status: deviceStatus });
  }

  if (entity.link) {
    // a link cannot come up before its device is running, so it reads as
    // blocked until the device gate is met rather than as its own failure.
    const blocked = deviceStatus !== undefined && deviceStatus !== "met";
    gates.push({
      key: "link",
      status: blocked ? "blocked" : linkGateStatus(entity.link.status),
    });
  }

  return {
    gates,
    ready: gates.every((g) => g.status === "met"),
    failed: gates.some((g) => g.status === "failed"),
  };
}

export function gateValue(entity: Entity, gate: ReadinessGate): string {
  switch (gate.key) {
    case "position":
      return gate.status === "met" ? "Positioned" : "No position";
    case "device":
      return entity.device ? formatDeviceState(entity.device.state).label : "Unknown";
    case "link":
      return gate.status === "blocked"
        ? "Waiting for device"
        : formatLinkStatus(entity.link?.status).label;
  }
}

const BLOCKER_SEVERITY: Record<ReadinessGateStatus, number> = {
  met: 0,
  blocked: 1,
  pending: 2,
  unmet: 2,
  degraded: 3,
  failed: 4,
};

// the most severe non-met gate, so a failed gate isn't hidden behind an
// earlier not-met one (e.g. "no position"). ties keep gate order.
export function worstBlocker(r: AssetReadiness): ReadinessGate | undefined {
  let worst: ReadinessGate | undefined;
  for (const gate of r.gates) {
    if (gate.status === "met") continue;
    if (!worst || BLOCKER_SEVERITY[gate.status] > BLOCKER_SEVERITY[worst.status]) {
      worst = gate;
    }
  }
  return worst;
}

// severity of an asset's worst readiness blocker; 0 when ready. higher is worse.
export function readinessSeverity(entity: Entity): number {
  const blocker = worstBlocker(deriveAssetReadiness(entity));
  return blocker ? BLOCKER_SEVERITY[blocker.status] : 0;
}
