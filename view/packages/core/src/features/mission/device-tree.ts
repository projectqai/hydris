import type { Entity } from "@projectqai/proto/world";

import { getDeviceName } from "../../lib/api/use-track-utils";

function getAncestorIds(entities: Map<string, Entity>, entity: Entity): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();

  for (let id = entity.device?.parent; id && !seen.has(id); id = entities.get(id)?.device?.parent) {
    seen.add(id);
    ancestors.push(id);
  }

  return ancestors;
}

export function getRootId(entities: Map<string, Entity>, device: Entity): string {
  return getAncestorIds(entities, device).at(-1) ?? device.id;
}

export function getChildOfRootId(entities: Map<string, Entity>, device: Entity): string {
  return [device.id, ...getAncestorIds(entities, device)].at(-2) ?? device.id;
}

export function getDevicesBelow(
  entities: Map<string, Entity>,
  devices: Entity[],
  ancestorId: string,
): Entity[] {
  return devices.filter((device) => getAncestorIds(entities, device).includes(ancestorId));
}

export function byLabel(a: Entity, b: Entity): number {
  return getDeviceName(a).localeCompare(getDeviceName(b)) || a.id.localeCompare(b.id);
}
