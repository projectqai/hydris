import type { RadialMenuItem } from "@hydris/ui/radial-menu/types";
import type { Entity } from "@projectqai/proto/world";

import { getTaskableLabel, isRepositionable } from "../../../../lib/api/use-track-utils";
import { isDrawn, readDrawing } from "../../utils/transform-entities";

const MAX_SLICES = 6;

function toTaskItem(t: Entity): RadialMenuItem {
  return {
    id: `task:${t.id}`,
    label: getTaskableLabel(t),
    disabled: t.taskable?.disabled !== undefined,
  };
}

export function resolveRadialItems(
  entity: Entity,
  taskables: readonly Entity[],
  canPlace: boolean,
): RadialMenuItem[] {
  const builtIns: RadialMenuItem[] = [];
  const drawing = readDrawing(entity);
  if (entity.device) builtIns.push({ id: "built-in:configure", label: "Configure" });
  if (entity.geo) builtIns.push({ id: "built-in:follow", label: "Follow" });
  if (isRepositionable(entity) && canPlace) {
    builtIns.push({ id: "built-in:reposition", label: "Reposition" });
  }
  if (drawing && canPlace) builtIns.push({ id: "built-in:move", label: "Move" });
  if (drawing) builtIns.push({ id: "built-in:edit", label: "Edit" });
  if (entity.device?.parent || isDrawn(entity)) {
    builtIns.push({ id: "built-in:delete", label: "Delete", variant: "destructive" });
  }

  const taskItems = taskables.slice(0, MAX_SLICES - builtIns.length).map(toTaskItem);

  return [...taskItems, ...builtIns];
}

export function resolvePositionItems(taskables: readonly Entity[]): RadialMenuItem[] {
  return taskables.slice(0, MAX_SLICES).map(toTaskItem);
}
