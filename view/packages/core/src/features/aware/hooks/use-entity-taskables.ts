import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { useEntityStore } from "../store/entity-store";

function references(entity: Entity, targetEntityId: string): boolean {
  if (!entity.taskable) return false;
  const target = entity.taskable.target;
  const requiresTarget =
    target?.position != null || target?.entity != null || target?.waypoints != null;
  const isAssignee = entity.taskable.assignee.some((a) => a.entityId === targetEntityId);
  if (requiresTarget && isAssignee) return false;

  const inContext = entity.taskable.context.some((c) => c.entityId === targetEntityId);
  const inTarget =
    target?.entity != null &&
    (target.entity.entity.length === 0 || target.entity.entity.includes(targetEntityId));
  return inContext || isAssignee || inTarget;
}

export function useEntityTaskables(entityId: string | null | undefined): Entity[] {
  return useEntityStore(
    useShallow((s) => {
      if (!entityId) return [];
      const result: Entity[] = [];
      for (const e of s.entities.values()) {
        if (references(e, entityId)) result.push(e);
      }
      result.sort((a, b) => (b.taskable?.priority ?? 0) - (a.taskable?.priority ?? 0));
      return result;
    }),
  );
}

export function isCommissionPositionTaskable(entity: Entity): boolean {
  const kind = entity.taskable?.taxonomy?.kind;
  return kind?.case === "commission" && kind.value.kind.case === "position";
}

// Taskables that accept a geo position for an empty spot.
export function usePositionTaskables(): Entity[] {
  return useEntityStore(
    useShallow((s) => {
      const result: Entity[] = [];
      for (const e of s.entities.values()) {
        if (e.taskable?.target?.position) result.push(e);
      }
      result.sort((a, b) => (b.taskable?.priority ?? 0) - (a.taskable?.priority ?? 0));
      return result;
    }),
  );
}
