import type { StateSeverity } from "@hydris/ui/lib/severity";
import type { CommandTriggerStatus } from "@hydris/ui/top-bar/command-trigger";
import type { ConfigurableComponent, Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";
import { format, isSameDay } from "date-fns";

import type { Timestamp } from "../../lib/api/use-track-utils";
import { formatTime, getEntityError, timestampToMs } from "../../lib/api/use-track-utils";
import {
  formatConfigurableState,
  formatDeviceState,
  formatLinkStatus,
} from "../aware/utils/format-entity";
import { byLabel, getChildOfRootId, getDevicesBelow, getRootId } from "./device-tree";
import type { DeviceGroups, ServiceGroup, SourceKind } from "./sources";
import {
  countsAsDevice,
  countsInRollup,
  deviceStateOutranks,
  getOtherServices,
  getReportedSourceKinds,
  getSourceServices,
  hasRaisedLink,
  inRollup,
  isSetUp,
  ownStateCounts,
  vouchesFor,
} from "./sources";

type RankedReading = ReturnType<typeof formatDeviceState> & {
  rank: number;
  error?: string;
  entityId: string;
  scheduledAt?: Timestamp;
};

type StateRank = {
  configurable?: ConfigurableState[];
  device?: DeviceState[];
  link?: LinkStatus[];
};

const INACTIVE: StateRank = { configurable: [ConfigurableState.ConfigurableStateInactive] };

const STATES_WORST_FIRST: StateRank[] = [
  { configurable: [ConfigurableState.ConfigurableStateConflict] },
  {
    configurable: [ConfigurableState.ConfigurableStateFailed],
    device: [DeviceState.DeviceStateFailed],
    link: [LinkStatus.LinkStatusLost],
  },
  { device: [DeviceState.DeviceStateDegraded], link: [LinkStatus.LinkStatusDegraded] },
  { configurable: [ConfigurableState.ConfigurableStateStarting] },
  { device: [DeviceState.DeviceStatePending] },
  INACTIVE,
  {
    configurable: [
      ConfigurableState.ConfigurableStateActive,
      ConfigurableState.ConfigurableStateScheduled,
    ],
    device: [DeviceState.DeviceStateActive],
  },
];

const UNKNOWN_RANK = STATES_WORST_FIRST.indexOf(INACTIVE);

export type TileVariant = "default" | "success" | "pending" | "alert";

const SEVERITY_VARIANTS: Record<StateSeverity, TileVariant> = {
  neutral: "default",
  success: "success",
  pending: "pending",
  alert: "alert",
};

export function isRaised(severity: StateSeverity | TileVariant): severity is "pending" | "alert" {
  return severity === "alert" || severity === "pending";
}

function rankOf(matches: (entry: StateRank) => boolean | undefined): number {
  const rank = STATES_WORST_FIRST.findIndex(matches);

  return rank === -1 ? UNKNOWN_RANK : rank;
}

function readConfigurable(
  entity: Entity,
  { state, scheduledAt }: ConfigurableComponent,
): RankedReading {
  const rank = rankOf((entry) => entry.configurable?.includes(state));
  const error = getEntityError(entity);
  const reading = { ...formatConfigurableState(state), rank, error, entityId: entity.id };

  return state === ConfigurableState.ConfigurableStateScheduled
    ? { ...reading, scheduledAt }
    : reading;
}

function readDevice(entity: Entity, error = getEntityError(entity)): RankedReading {
  const state = entity.device?.state;
  const rank = rankOf((entry) => state !== undefined && entry.device?.includes(state));

  return { ...formatDeviceState(state), rank, error, entityId: entity.id };
}

function readLink(entity: Entity, error: string | undefined): RankedReading {
  const status = entity.link?.status;
  const rank = rankOf((entry) => status !== undefined && entry.link?.includes(status));

  return { ...formatLinkStatus(status), rank, error, entityId: entity.id };
}

function moreSevere(a: RankedReading, b: RankedReading): RankedReading {
  return b.rank < a.rank ? b : a;
}

// the configurable names the state, the device names an entity without one. a raised device state
// or link counts on top of it. the worst reading wins, a tie keeps the named one
function read(entity: Entity, configurable: ConfigurableComponent | undefined): RankedReading {
  const named = configurable ? readConfigurable(entity, configurable) : readDevice(entity);
  const raised: RankedReading[] = [];

  if (deviceStateOutranks(entity, configurable)) {
    raised.push(entity.config ? readDevice(entity, entity.device?.error) : readDevice(entity));
  }

  if (hasRaisedLink(entity)) raised.push(readLink(entity, named.error));

  return raised.reduce(moreSevere, named);
}

function vouchedFor(variant: TileVariant, vouched: boolean): TileVariant {
  return variant === "success" && !vouched ? "default" : variant;
}

function getChildReading(entity: Entity): RankedReading {
  return read(entity, entity.configurable);
}

export type TileState = {
  variant: TileVariant;
  label?: string;
  error?: string;
  scheduledAt?: Timestamp;
};

export type OwnState = TileState & { label: string };

type Tile = { variant: TileVariant; reading: RankedReading };

function stateOf({ variant, reading }: Tile): OwnState {
  const { label, error, scheduledAt } = reading;

  return { variant, label, error, scheduledAt };
}

const TILE_ORDER: Record<TileVariant, number> = { alert: 0, pending: 1, default: 2, success: 3 };

function byTile(a: Tile, b: Tile): number {
  return TILE_ORDER[a.variant] - TILE_ORDER[b.variant] || a.reading.rank - b.reading.rank;
}

function moreSevereTile(a: Tile, b: Tile): Tile {
  return byTile(b, a) < 0 ? b : a;
}

function getDeviceTile(device: Entity, vouched: boolean): Tile {
  const reading = getChildReading(device);

  return { variant: vouchedFor(SEVERITY_VARIANTS[reading.severity], vouched), reading };
}

function getServiceTile(entry: ServiceGroup, isConnected: boolean): Tile | undefined {
  if (!inRollup(entry)) return undefined;

  const { service, devices } = entry;
  const group = devices.filter(countsInRollup);
  const readings = group.map(getChildReading);
  const own = service && ownStateCounts(service) ? read(service, service.configurable) : undefined;
  const worst = (own ? [own, ...readings] : readings).reduce(moreSevere);

  if (isRaised(worst.severity)) return { variant: worst.severity, reading: worst };

  const named = own ?? worst;

  if (named.severity === "neutral") return { variant: "default", reading: named };

  return { variant: vouchedFor(service ? "success" : "default", isConnected), reading: named };
}

export function getServiceState(entry: ServiceGroup, isConnected: boolean): TileState {
  const tile = getServiceTile(entry, isConnected);

  return tile ? stateOf(tile) : { variant: "default" };
}

function getSourceRowTile(
  entity: Entity,
  groups: DeviceGroups,
  entities: Map<string, Entity>,
  isConnected: boolean,
): Tile {
  const entry = groups.services.get(entity.id);
  const vouched = vouchesFor(entities, entity, isConnected);
  const serviceTile = entry?.service && getServiceTile(entry, vouched);

  if (serviceTile) return serviceTile;

  const service = groups.services.get(getRootId(entities, entity));
  const below = service ? getDevicesBelow(entities, service.devices, entity.id) : [];

  return getRowTile(entity, below, vouched);
}

export function getSourceRowState(
  entity: Entity,
  groups: DeviceGroups,
  entities: Map<string, Entity>,
  isConnected: boolean,
): OwnState {
  return stateOf(getSourceRowTile(entity, groups, entities, isConnected));
}

export function byRowSeverity(
  groups: DeviceGroups,
  entities: Map<string, Entity>,
  isConnected: boolean,
) {
  const tileOf = (entity: Entity) => getSourceRowTile(entity, groups, entities, isConnected);

  return (a: Entity, b: Entity) => byTile(tileOf(a), tileOf(b)) || byLabel(a, b);
}

export type CategoryState = Omit<TileState, "error"> & {
  label: string;
  entityId: string;
  services: number;
  devices: number;
};

type CategoryPart = { tiles: Tile[]; setUp: number; devices: number };

function getCategoryPart(
  entry: ServiceGroup,
  isConnected: boolean,
  kind: SourceKind | undefined,
): CategoryPart {
  const counted = entry.devices.filter(countsInRollup);
  const devices = counted.filter((device) => countsAsDevice(entry, device, kind)).length;

  if (!entry.service) {
    const tiles = counted.map((device) => getDeviceTile(device, false));

    return { tiles, setUp: 0, devices };
  }

  const tile = getServiceTile(entry, isConnected);

  if (!tile) return { tiles: [], setUp: 0, devices: 0 };

  return { tiles: [tile], setUp: isSetUp(entry.service) ? 1 : 0, devices };
}

function getCategoryState(
  services: ServiceGroup[],
  isConnected: boolean,
  kind?: SourceKind,
): CategoryState | undefined {
  const parts = services.map((entry) => getCategoryPart(entry, isConnected, kind));
  const tiles = parts.flatMap((part) => part.tiles);

  if (tiles.length === 0) return undefined;

  const { variant, reading } = tiles.reduce(moreSevereTile);
  const { label, scheduledAt, entityId } = reading;
  const setUp = parts.reduce((sum, part) => sum + part.setUp, 0);
  const devices = parts.reduce((sum, part) => sum + part.devices, 0);

  return { variant, label, scheduledAt, entityId, services: setUp, devices };
}

export function getSourceState(
  kind: SourceKind,
  groups: DeviceGroups,
  isConnected: boolean,
): CategoryState | undefined {
  return getCategoryState(getSourceServices(kind, groups), isConnected, kind);
}

export function getOtherServicesState(
  groups: DeviceGroups,
  isConnected: boolean,
): CategoryState | undefined {
  return getCategoryState(getOtherServices(groups), isConnected);
}

export function getWithoutServiceState(
  groups: DeviceGroups,
  isConnected: boolean,
): CategoryState | undefined {
  return getCategoryState(groups.withoutService, isConnected);
}

// in the order of the Sources tiles, so a tie names what the first of them shows. a service listed
// under several kinds counts once
export function getSourcesState(
  groups: DeviceGroups,
  isConnected: boolean,
): CategoryState | undefined {
  return getCategoryState(
    [
      ...new Set(getReportedSourceKinds(groups).flatMap((kind) => getSourceServices(kind, groups))),
      ...getOtherServices(groups),
      ...groups.withoutService,
    ],
    isConnected,
  );
}

export function getMissionState(
  groups: DeviceGroups,
  isConnected: boolean,
): CommandTriggerStatus | undefined {
  const sources = getSourcesState(groups, isConnected);

  if (!sources || sources.variant === "default") return undefined;

  if (sources.variant === "success") return { severity: "success" };

  return { severity: sources.variant, label: sources.label };
}

function getOwnTile(entity: Entity, vouched: boolean): Tile {
  const tile = getDeviceTile(entity, vouched);

  return countsInRollup(entity) ? tile : { ...tile, variant: "default" };
}

export function getOwnState(entity: Entity, vouched: boolean): OwnState {
  return stateOf(getOwnTile(entity, vouched));
}

export type ServiceRow = { device: Entity; state: OwnState };

function getRowTile(device: Entity, below: Entity[], vouched: boolean): Tile {
  const raised = below
    .filter(countsInRollup)
    .map((entity) => getDeviceTile(entity, vouched))
    .filter((tile) => isRaised(tile.variant));

  return [getOwnTile(device, vouched), ...raised].reduce(moreSevereTile);
}

export function getDeviceState(device: Entity, below: Entity[], vouched: boolean): OwnState {
  return stateOf(getRowTile(device, below, vouched));
}

export function getServiceRows(
  { serviceId, devices }: { serviceId: string; devices: Entity[] },
  vouched: boolean,
): ServiceRow[] {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const below = new Map<string, Entity[]>();

  for (const device of devices) {
    const childId = getChildOfRootId(byId, device);

    if (childId !== device.id) below.set(childId, [...(below.get(childId) ?? []), device]);
  }

  return devices
    .filter((device) => device.device?.parent === serviceId)
    .map((device) => ({ device, tile: getRowTile(device, below.get(device.id) ?? [], vouched) }))
    .sort((a, b) => byTile(a.tile, b.tile) || byLabel(a.device, b.device))
    .map(({ device, tile }) => ({ device, state: stateOf(tile) }));
}

export function getStateLabel(
  state: { label?: string; scheduledAt?: Timestamp } | undefined,
  now: number,
): string | undefined {
  const at = timestampToMs(state?.scheduledAt);

  if (!state?.label || at <= now) return state?.label;

  const time = formatTime(state.scheduledAt);
  const when = isSameDay(at, now) ? time : `${format(at, "dd MMM")} ${time}`;

  return `${state.label} · ${when}`;
}
