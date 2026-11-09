import { EquipmentTaxonomySensorSchema } from "@projectqai/proto/taxonomy";
import type { ConfigurableComponent, DeviceComponent, Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";

import { getDeviceName } from "../../lib/api/use-track-utils";
import { byLabel, getRootId } from "./device-tree";

export type Service = Entity & { device: DeviceComponent };

export function isDeviceRoot(entity: Entity): entity is Service {
  return !!entity.device && !entity.device.parent;
}

export function awaitsSetup(entity: Entity): boolean {
  return !!entity.configurable && !entity.config;
}

function isNode(entity: Entity): boolean {
  return !!entity.device?.node;
}

// the node is a device root but never a service, so even a config does not set it up
export function isSetUp(service: Service): boolean {
  return !!service.config && !isNode(service);
}

// like a device that awaits setup, the node's own state counts only while it is raised
export function ownStateCounts(service: Service): boolean {
  if (isNode(service)) {
    return (
      hasRaisedDeviceState(service) || hasRaisedLink(service) || hasRaisedConfigurable(service)
    );
  }

  return isSetUp(service);
}

export const PLUGIN_DEVICE_CLASS = "plugin";

export function declares(entity: Entity, deviceClass: string): boolean {
  return !!entity.configurable?.supportedDeviceClasses.some((c) => c.class === deviceClass);
}

export function declaresDevices(entity: Entity): boolean {
  return !!entity.configurable?.supportedDeviceClasses.length;
}

// a source kind is the sensor taxonomy case a device reports, so a new kind needs no client change
export type SourceKind = string;

const NO_KIND: SourceKind = "sensor";

function getSensorKinds(entity: Entity): SourceKind[] {
  return (entity.classification?.taxonomy ?? []).flatMap(({ kind }) =>
    kind.case === "equipment" && kind.value.sensor ? [kind.value.sensor.kind.case ?? NO_KIND] : [],
  );
}

function isSourceDevice(kind: SourceKind, entity: Entity): boolean {
  return getSensorKinds(entity).includes(kind);
}

const PROTO_ORDER: string[] = [
  ...(EquipmentTaxonomySensorSchema.oneofs
    .find(({ localName }) => localName === "kind")
    ?.fields.map(({ localName }) => localName) ?? []),
  NO_KIND,
];

function byProtoOrder(a: SourceKind, b: SourceKind): number {
  return PROTO_ORDER.indexOf(a) - PROTO_ORDER.indexOf(b);
}

export type ServiceDevices = { serviceId: string; service: Service; devices: Entity[] };

export type MissingServiceDevices = { serviceId: string; service?: undefined; devices: Entity[] };

export type ServiceGroup = ServiceDevices | MissingServiceDevices;

export type DeviceGroups = {
  services: Map<string, ServiceGroup>;
  withoutService: MissingServiceDevices[];
};

function hasService(entities: Map<string, Entity>, device: Entity): boolean {
  return !!entities.get(getRootId(entities, device))?.device;
}

export function vouchesFor(
  entities: Map<string, Entity>,
  entity: Entity | undefined,
  isConnected: boolean,
): boolean {
  return isConnected && !!entity && hasService(entities, entity);
}

export function groupDevices(entities: Map<string, Entity>): DeviceGroups {
  const services = new Map<string, ServiceGroup>();
  const missing = new Map<string, MissingServiceDevices>();

  for (const e of entities.values()) {
    if (isDeviceRoot(e)) services.set(e.id, { serviceId: e.id, service: e, devices: [] });
  }

  for (const e of entities.values()) {
    if (!e.device || isDeviceRoot(e)) continue;

    const rootId = getRootId(entities, e);
    const group = services.get(rootId) ?? missing.get(rootId);

    if (group) group.devices.push(e);
    else if (!hasService(entities, e)) missing.set(rootId, { serviceId: rootId, devices: [e] });
  }

  const withoutService: MissingServiceDevices[] = [];

  for (const group of [...missing.values()].sort(byServiceId)) {
    if (getSourceKinds(group).length) services.set(group.serviceId, group);
    else withoutService.push({ ...group, devices: group.devices.sort(byLabel) });
  }

  return { services, withoutService };
}

// a service is a protocol, so only the devices it found say what kinds of source it is. it lists
// under every kind they report
function getSourceKinds({ devices }: ServiceGroup): SourceKind[] {
  return [...new Set(devices.flatMap(getSensorKinds))].sort(byProtoOrder);
}

export function getReportedSourceKinds(groups: DeviceGroups): SourceKind[] {
  return [...new Set([...groups.services.values()].flatMap(getSourceKinds))].sort(byProtoOrder);
}

// a source service also creates entities that are not its kind, such as parts of a device.
// a kind counts only its own devices, so a service listed under several kinds counts each once
export function countsAsDevice(group: ServiceGroup, entity: Entity, kind?: SourceKind): boolean {
  const kinds = kind ? [kind] : getSourceKinds(group);

  return !kinds.length || kinds.some((k) => isSourceDevice(k, entity));
}

export function getServiceLabel({ serviceId, service }: Omit<ServiceGroup, "devices">): string {
  return service ? getDeviceName(service) : serviceId;
}

function byServiceId(a: ServiceGroup, b: ServiceGroup): number {
  return a.serviceId.localeCompare(b.serviceId);
}

function byServiceLabel(a: ServiceGroup, b: ServiceGroup): number {
  return getServiceLabel(a).localeCompare(getServiceLabel(b)) || byServiceId(a, b);
}

export function getSourceServices(kind: SourceKind, groups: DeviceGroups): ServiceGroup[] {
  return [...groups.services.values()]
    .filter((group) => getSourceKinds(group).includes(kind))
    .sort(byServiceLabel);
}

export function getOtherServices(groups: DeviceGroups): ServiceDevices[] {
  return [...groups.services.values()]
    .filter(
      (group): group is ServiceDevices =>
        !!group.service && !getSourceKinds(group).length && inRollup(group),
    )
    .sort(byServiceLabel);
}

const RAISED_DEVICE_STATES = new Set([
  DeviceState.DeviceStateFailed,
  DeviceState.DeviceStateDegraded,
]);

const RAISED_LINKS = new Set([LinkStatus.LinkStatusLost, LinkStatus.LinkStatusDegraded]);

const RAISED_CONFIGURABLE_STATES = new Set([
  ConfigurableState.ConfigurableStateStarting,
  ConfigurableState.ConfigurableStateFailed,
  ConfigurableState.ConfigurableStateConflict,
]);

export function hasRaisedDeviceState(entity: Entity): boolean {
  const state = entity.device?.state;

  return state !== undefined && RAISED_DEVICE_STATES.has(state);
}

function hasRaisedConfigurable(entity: Entity): boolean {
  const state = entity.configurable?.state;

  return state !== undefined && RAISED_CONFIGURABLE_STATES.has(state);
}

// a set-up entity's device state counts only while the configurable runs, because nothing resets it
// when a run stops. without a config there is no run, so a raised device state counts as sent. the
// node is never set up, so its raised device state always counts
export function deviceStateOutranks(
  entity: Entity,
  configurable: ConfigurableComponent | undefined,
): boolean {
  if (!hasRaisedDeviceState(entity)) return false;

  return (
    !entity.config ||
    isNode(entity) ||
    configurable?.state === ConfigurableState.ConfigurableStateActive
  );
}

// the configurable names the state unless a raised device state outranks it. without a config no
// controller runs, so the configurable reads Inactive
export function getNamingConfigurable(entity: Entity): ConfigurableComponent | undefined {
  const { configurable } = entity;

  return deviceStateOutranks(entity, configurable) ? undefined : configurable;
}

export function hasRaisedLink(entity: Entity): boolean {
  const status = entity.link?.status;

  return status !== undefined && RAISED_LINKS.has(status);
}

// discovery writes Pending before setup, and a device without a configurable is never set up,
// so neither Pending counts on its own
export function countsInRollup(entity: Entity): boolean {
  const state = entity.device?.state;

  if (hasRaisedLink(entity)) return true;

  if (awaitsSetup(entity)) return hasRaisedDeviceState(entity);

  return !!entity.configurable || state !== DeviceState.DeviceStatePending;
}

export function inRollup({ service, devices }: ServiceGroup): boolean {
  return (!!service && ownStateCounts(service)) || devices.some(countsInRollup);
}
