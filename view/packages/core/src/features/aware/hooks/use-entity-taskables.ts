import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { useEntityStore } from "../store/entity-store";

function references(entity: Entity, targetEntityId: string): boolean {
  if (!entity.taskable) return false;
  const inContext = entity.taskable.context.some((c) => c.entityId === targetEntityId);
  const inAssignee = entity.taskable.assignee.some((a) => a.entityId === targetEntityId);
  return inContext || inAssignee;
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
