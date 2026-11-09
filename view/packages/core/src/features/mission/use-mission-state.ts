import type { CommandTriggerStatus } from "@hydris/ui/top-bar/command-trigger";
import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import type { Timestamp } from "../../lib/api/use-track-utils";
import { timestampToMs } from "../../lib/api/use-track-utils";
import { useNowUntil } from "../../lib/use-now-until";
import { useEntityStore } from "../aware/store/entity-store";
import type { CategoryState } from "./provider-state";
import {
  getDeviceState,
  getMissionState,
  getOtherServicesState,
  getOwnState,
  getServiceRows,
  getServiceState,
  getSourcesState,
  getSourceState,
  getStateLabel,
  getWithoutServiceState,
} from "./provider-state";
import type { DeviceGroups, SourceKind } from "./sources";
import { vouchesFor } from "./sources";
import { selectDeviceGroups, useDevicesBelow, useService, useServiceDevices } from "./use-sources";

export function useStateLabel(
  state: { label?: string; scheduledAt?: Timestamp } | undefined,
): string | undefined {
  const now = useNowUntil(timestampToMs(state?.scheduledAt));

  return getStateLabel(state, now);
}

function useVouched(entity: Entity | undefined): boolean {
  return useEntityStore((s) => vouchesFor(s.entities, entity, s.isConnected));
}

export function useOwnState(entity: Entity) {
  return getOwnState(entity, useVouched(entity));
}

export function useServiceState(serviceId: string) {
  const service = useService(serviceId);
  const devices = useServiceDevices(serviceId);
  const vouched = useVouched(service);
  const group = { serviceId, service, devices };

  return {
    service,
    rows: getServiceRows(group, vouched),
    state: getServiceState(group, vouched),
  };
}

export function useDeviceState(device: Entity) {
  const below = useDevicesBelow(device.id);
  const vouched = useVouched(device);

  return {
    rows: getServiceRows({ serviceId: device.id, devices: below }, vouched),
    state: getDeviceState(device, below, vouched),
  };
}

export function useGroupsState<T>(get: (groups: DeviceGroups, isConnected: boolean) => T): T {
  return useEntityStore(useShallow((s) => get(selectDeviceGroups(s), s.isConnected)));
}

export function useMissionState(): CommandTriggerStatus | undefined {
  return useGroupsState(getMissionState);
}

export function useSourcesState(): CategoryState | undefined {
  return useGroupsState(getSourcesState);
}

export function useSourceState(kind: SourceKind): CategoryState | undefined {
  return useGroupsState((groups, isConnected) => getSourceState(kind, groups, isConnected));
}

export function useOtherServicesState(): CategoryState | undefined {
  return useGroupsState(getOtherServicesState);
}

export function useWithoutServiceState(): CategoryState | undefined {
  return useGroupsState(getWithoutServiceState);
}
