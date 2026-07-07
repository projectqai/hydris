import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";

/**
 * Classify a stream event into pendingUpdates or pendingDeletes.
 * Mutates both maps in place; an entity is never left in both.
 */
export function classifyEvent(
  event: { entity?: Entity; t: EntityChange },
  pendingUpdates: Map<string, Entity>,
  pendingDeletes: Set<string>,
): void {
  const { entity, t } = event;
  if (!entity?.id) return;

  if (t === EntityChange.EntityChangeUpdated) {
    pendingDeletes.delete(entity.id);
    pendingUpdates.set(entity.id, entity);
  } else if (t === EntityChange.EntityChangeExpired || t === EntityChange.EntityChangeUnobserved) {
    pendingUpdates.delete(entity.id);
    pendingDeletes.add(entity.id);
  }
}
