import { create } from "@bufbuild/protobuf";
import type { TaskExecutionTarget } from "@projectqai/proto/tasking";
import {
  TaskExecutionTargetEntitySchema,
  TaskExecutionTargetSchema,
} from "@projectqai/proto/tasking";
import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { runFreshness } from "../../../lib/api/task-outcomes";
import { useEntityStore } from "../store/entity-store";

function isAssignee(entity: Entity, entityId: string): boolean {
  return entity.taskable?.assignee.some((a) => a.entityId === entityId) ?? false;
}

// A mode taskable runs only with a mode, so the plain lists never include one
function isModeTaskable(entity: Entity): boolean {
  return entity.taskable?.target?.mode != null;
}

// An action the entity runs itself and that takes no target, or one that lists
// the entity as context.
function owns(entity: Entity, entityId: string): boolean {
  if (!entity.taskable || isModeTaskable(entity)) return false;

  if (isAssignee(entity, entityId)) {
    const target = entity.taskable.target;

    return target?.position == null && target?.entity == null && target?.waypoints == null;
  }

  return entity.taskable.context.some((c) => c.entityId === entityId);
}

// A mode taskable switches its assignee, so only the assignee shows its picker
function switchesMode(entity: Entity, entityId: string): boolean {
  return isModeTaskable(entity) && isAssignee(entity, entityId);
}

function aimsAt(entity: Entity, entityId: string): boolean {
  if (isAssignee(entity, entityId) || isModeTaskable(entity)) return false;

  const target = entity.taskable?.target?.entity;

  return target != null && (target.entity.length === 0 || target.entity.includes(entityId));
}

function references(entity: Entity, entityId: string): boolean {
  return owns(entity, entityId) || aimsAt(entity, entityId);
}

export function entityTarget(taskable: Entity, entityId: string): TaskExecutionTarget | undefined {
  if (!aimsAt(taskable, entityId)) return undefined;

  return create(TaskExecutionTargetSchema, {
    kind: {
      case: "entity",
      value: create(TaskExecutionTargetEntitySchema, { entity: [entityId] }),
    },
  });
}

function useTaskables(
  entityId: string | null | undefined,
  matches: (entity: Entity, entityId: string) => boolean,
): Entity[] {
  return useEntityStore(
    useShallow((s) => {
      if (!entityId) return [];
      const result: Entity[] = [];
      for (const e of s.entities.values()) {
        if (matches(e, entityId)) result.push(e);
      }
      result.sort((a, b) => (b.taskable?.priority ?? 0) - (a.taskable?.priority ?? 0));
      return result;
    }),
  );
}

export function useEntityTaskables(entityId: string | null | undefined): Entity[] {
  return useTaskables(entityId, references);
}

export function useOwnTaskables(entityId: string | null | undefined): Entity[] {
  return useTaskables(entityId, owns);
}

export function useModeTaskables(entityId: string | null | undefined): Entity[] {
  return useTaskables(entityId, switchesMode);
}

function isOwnExecution(entity: Entity, taskableId: string): boolean {
  return entity.taskExecution != null && entity.id === taskableId;
}

function isSpawnedExecution(entity: Entity, taskableId: string): boolean {
  return entity.taskExecution?.task === taskableId;
}

export function useTaskExecutions(taskableId: string): Entity[] {
  return useEntityStore(
    useShallow((s) => {
      const result: Entity[] = [];

      for (const e of s.entities.values()) {
        if (isOwnExecution(e, taskableId) || isSpawnedExecution(e, taskableId)) result.push(e);
      }

      result.sort((a, b) => runFreshness(b) - runFreshness(a));

      return result;
    }),
  );
}

export function isCommissionPositionTaskable(entity: Entity): boolean {
  const kind = entity.taskable?.taxonomy?.kind;
  return kind?.case === "commission" && kind.value.kind.case === "position";
}

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
