import type { Entity, MissionPack } from "@projectqai/proto/world";

import { getDeviceName } from "../../lib/api/use-track-utils";
import type { CategoryState, TileVariant } from "../mission/provider-state";
import {
  byRowSeverity,
  getOtherServicesState,
  getOwnState,
  getSourceRowState,
  getSourceState,
  getWithoutServiceState,
} from "../mission/provider-state";
import { getSourceTexts, OTHER_SERVICES, WITHOUT_SERVICE } from "../mission/source-texts";
import type { DeviceGroups, ServiceGroup, SourceKind } from "../mission/sources";
import {
  countsInRollup,
  getOtherServices,
  getSourceServices,
  ownStateCounts,
} from "../mission/sources";

type VersionRow = {
  status: "ok" | "warn";
  pack: string;
  engine: string;
};

type StaticHealth = {
  entityCount: number;
  layoutNames: string[];
  version: VersionRow;
  artifacts: { count: number; size: string };
};

// decimal SI (base 1000): units are kB/MB, not 1024-based KiB/MiB
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let size = bytes / 1000;
  let i = 0;
  while (size >= 1000 && i < units.length - 1) {
    size /= 1000;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

export function computeStatic(mission: MissionPack, currentVersion: string): StaticHealth {
  return {
    entityCount: mission.entityCount ?? 0,
    layoutNames: Object.keys(mission.layouts).sort(),
    version: computeVersion(mission, currentVersion),
    artifacts: {
      count: mission.artifactCount ?? 0,
      size: formatBytes(Number(mission.artifactTotalSize ?? 0n)),
    },
  };
}

function computeVersion(mission: MissionPack, currentVersion: string): VersionRow {
  const pack = mission.packVersion ?? "";
  const engine = currentVersion;

  if (!pack) return { status: "warn", pack, engine };

  return { status: pack === engine ? "ok" : "warn", pack, engine };
}

export function getSourceRow(
  entity: Entity,
  groups: DeviceGroups,
  entities: Map<string, Entity>,
  isConnected: boolean,
) {
  return {
    name: getDeviceName(entity),
    ...getSourceRowState(entity, groups, entities, isConnected),
    // a failure below raises the row, but its reason stays on the entity that reported it
    error: getOwnState(entity, false).error,
  };
}

type GetState = (groups: DeviceGroups, isConnected: boolean) => CategoryState | undefined;

export type SourcesSection = {
  title: string;
  getState: GetState;
  getEntities: (
    groups: DeviceGroups,
    entities: Map<string, Entity>,
    isConnected: boolean,
  ) => Entity[];
};

function counted(services: ServiceGroup[]): Entity[] {
  return services.flatMap(({ service, devices }) => [
    ...(service && ownStateCounts(service) ? [service] : []),
    ...devices.filter(countsInRollup),
  ]);
}

function section(
  title: string,
  getState: GetState,
  getServices: (groups: DeviceGroups) => ServiceGroup[],
): SourcesSection {
  return {
    title,
    getState,
    getEntities: (groups, entities, isConnected) =>
      counted(getServices(groups)).sort(byRowSeverity(groups, entities, isConnected)),
  };
}

export function getSourcesSections(kinds: SourceKind[]): SourcesSection[] {
  return [
    ...kinds.map((kind) =>
      section(
        getSourceTexts(kind).title,
        (groups, isConnected) => getSourceState(kind, groups, isConnected),
        (groups) => getSourceServices(kind, groups),
      ),
    ),
    section(OTHER_SERVICES, getOtherServicesState, getOtherServices),
    section(WITHOUT_SERVICE, getWithoutServiceState, (groups) => groups.withoutService),
  ];
}

type DoneAction = { label: string; variant: "default" | "success" };

const DONE_ACTIONS: Record<TileVariant, DoneAction> = {
  success: { label: "Done", variant: "success" },
  default: { label: "Done", variant: "default" },
  pending: { label: "Proceed anyway", variant: "default" },
  alert: { label: "Proceed anyway", variant: "default" },
};

export function getDoneAction(sources: CategoryState | undefined): DoneAction {
  return DONE_ACTIONS[sources?.variant ?? "default"];
}
