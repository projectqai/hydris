import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { useEntityStore } from "../aware/store/entity-store";
import { getDevicesBelow, getRootId } from "./device-tree";
import type {
  DeviceGroups,
  MissingServiceDevices,
  Service,
  ServiceGroup,
  SourceKind,
} from "./sources";
import {
  declares,
  getOtherServices,
  getReportedSourceKinds,
  getSourceServices,
  groupDevices,
  PLUGIN_DEVICE_CLASS,
} from "./sources";

const NO_DEVICES: Entity[] = [];

const groupsByUpdate = new WeakMap<object, DeviceGroups>();

// the entities map is mutated in place, so the store state object is what changes with each update
export function selectDeviceGroups(state: { entities: Map<string, Entity> }): DeviceGroups {
  const cached = groupsByUpdate.get(state);

  if (cached) return cached;

  const groups = groupDevices(state.entities);

  groupsByUpdate.set(state, groups);

  return groups;
}

export function useSourceServices(
  kind: SourceKind,
  include: (group: ServiceGroup) => boolean = () => true,
): string[] {
  return useEntityStore(
    useShallow((s) =>
      getSourceServices(kind, selectDeviceGroups(s))
        .filter(include)
        .map(({ serviceId }) => serviceId),
    ),
  );
}

export function useReportedSourceKinds(): SourceKind[] {
  return useEntityStore(useShallow((s) => getReportedSourceKinds(selectDeviceGroups(s))));
}

export function useService(serviceId: string): Service | undefined {
  return useEntityStore((s) => selectDeviceGroups(s).services.get(serviceId)?.service);
}

export function useOtherServices(): Service[] {
  return useEntityStore(
    useShallow((s) => getOtherServices(selectDeviceGroups(s)).map(({ service }) => service)),
  );
}

export function usePluginServiceId(): string | undefined {
  return useEntityStore(
    (s) =>
      [...selectDeviceGroups(s).services.values()].find(
        ({ service }) => service && declares(service, PLUGIN_DEVICE_CLASS),
      )?.serviceId,
  );
}

export function useDevicesWithoutService(): MissingServiceDevices[] {
  return useEntityStore(useShallow((s) => selectDeviceGroups(s).withoutService));
}

export function useHasDevicesWithoutService(): boolean {
  return useEntityStore((s) => selectDeviceGroups(s).withoutService.length > 0);
}

export function useServiceDevices(serviceId: string): Entity[] {
  return useEntityStore(
    useShallow((s) => selectDeviceGroups(s).services.get(serviceId)?.devices ?? NO_DEVICES),
  );
}

export function useDevicesBelow(deviceId: string): Entity[] {
  return useEntityStore(
    useShallow((s) => {
      const device = s.entities.get(deviceId);

      if (!device) return NO_DEVICES;

      const service = selectDeviceGroups(s).services.get(getRootId(s.entities, device));

      return service ? getDevicesBelow(s.entities, service.devices, deviceId) : NO_DEVICES;
    }),
  );
}
