import type { RadialMenuItem } from "@hydris/ui/radial-menu/types";
import type { Entity } from "@projectqai/proto/world";

const MAX_SLICES = 6;

function toTaskItem(t: Entity): RadialMenuItem {
  return { id: `task:${t.id}`, label: t.taskable?.label || t.label || t.id };
}

export function resolveRadialItems(
  entity: Entity,
  taskables: readonly Entity[],
  canPlace: boolean,
): RadialMenuItem[] {
  const builtIns: RadialMenuItem[] = [];
  if (entity.device) builtIns.push({ id: "built-in:configure", label: "Configure" });
  if (entity.geo) builtIns.push({ id: "built-in:follow", label: "Follow" });
  if (entity.symbol && !entity.pose && canPlace) {
    builtIns.push({ id: "built-in:reposition", label: "Reposition" });
  }
  if (entity.device?.parent) {
    builtIns.push({ id: "built-in:delete", label: "Delete", variant: "destructive" });
  }

  const taskItems = taskables.slice(0, MAX_SLICES - builtIns.length).map(toTaskItem);

  return [...taskItems, ...builtIns];
}

export function resolvePositionItems(taskables: readonly Entity[]): RadialMenuItem[] {
  return taskables.slice(0, MAX_SLICES).map(toTaskItem);
}
