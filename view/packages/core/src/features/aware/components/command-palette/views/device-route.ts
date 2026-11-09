import type { PaletteAction, PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import type { Entity } from "@projectqai/proto/world";
import type { Dispatch } from "react";

import type { ServiceDevices, ServiceGroup, SourceKind } from "../../../../mission/sources";
import { awaitsSetup, declares, declaresDevices } from "../../../../mission/sources";
import { selectDeviceGroups } from "../../../../mission/use-sources";
import { useEntityStore } from "../../../store/entity-store";
import { hasSchemaFields } from "../../schema-form";

function needsConfigStep({ service, devices }: ServiceDevices): boolean {
  if (hasSchemaFields(service.configurable?.schema)) {
    return !declaresDevices(service) && awaitsSetup(service);
  }

  const childSetUp = devices.some(
    (device) => device.config && declares(service, device.device?.class ?? ""),
  );

  return declaresDevices(service) && !childSetUp;
}

function serviceMode(group: ServiceGroup, source: SourceKind): PaletteMode {
  if (group.service && needsConfigStep(group)) {
    return { kind: "setup", entityId: group.serviceId };
  }

  return { kind: "source-service", source, providerId: group.serviceId };
}

export function openService(
  serviceId: string,
  source: SourceKind,
  dispatch: Dispatch<PaletteAction>,
) {
  const group = selectDeviceGroups(useEntityStore.getState()).services.get(serviceId);

  if (group) dispatch({ type: "push", mode: serviceMode(group, source) });
}

export function deviceMode(device: Entity, source?: SourceKind): PaletteMode {
  const entityId = device.id;

  if (awaitsSetup(device)) return { kind: "setup", entityId };

  if (device.camera) return { kind: "camera", entityId };

  return { kind: "device", source, entityId };
}
