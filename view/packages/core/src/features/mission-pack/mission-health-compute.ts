import type { Entity, MissionPack } from "@projectqai/proto/world";
import { ConfigurableState } from "@projectqai/proto/world";

export type RowStatus = "ok" | "warn" | "fail";

export type ControllersRow = {
  status: RowStatus;
  running: number;
  expected: number;
  runningIds: string[];
  pending: string[];
  failed: { id: string; error: string }[];
};

type VersionRow = {
  status: RowStatus;
  pack: string;
  engine: string;
};

export type StaticHealth = {
  entityCount: number;
  layoutNames: string[];
  version: VersionRow;
  artifacts: { count: number; size: string };
};

export type HealthState = StaticHealth & {
  controllers: ControllersRow;
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

export type ComputeInput = {
  mission: MissionPack;
  entities: Map<string, Entity>;
  currentVersion: string;
};

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

export function computeHealth(input: ComputeInput): HealthState {
  return {
    ...computeStatic(input.mission, input.currentVersion),
    controllers: computeControllers(input.entities),
  };
}

export function computeControllers(entities: Map<string, Entity>): ControllersRow {
  const failed: { id: string; error: string }[] = [];
  const runningIds: string[] = [];
  const pending: string[] = [];

  for (const e of entities.values()) {
    if (!e.device || !e.configurable) continue;
    const state = e.configurable.state;
    if (
      state === ConfigurableState.ConfigurableStateActive ||
      state === ConfigurableState.ConfigurableStateScheduled
    ) {
      runningIds.push(e.id);
    } else if (
      state === ConfigurableState.ConfigurableStateFailed ||
      state === ConfigurableState.ConfigurableStateConflict
    ) {
      failed.push({ id: e.id, error: e.configurable.error ?? "" });
    } else if (e.config) {
      pending.push(e.id);
    }
  }

  const expected = runningIds.length + pending.length + failed.length;
  const running = runningIds.length;
  let status: RowStatus;
  if (failed.length > 0) status = "fail";
  else if (running < expected) status = "warn";
  else status = "ok";

  return { status, running, expected, runningIds, pending, failed };
}

function computeVersion(mission: MissionPack, currentVersion: string): VersionRow {
  const pack = mission.packVersion ?? "";
  const engine = currentVersion;
  if (!pack) return { status: "warn", pack, engine };
  return { status: pack === engine ? "ok" : "warn", pack, engine };
}
