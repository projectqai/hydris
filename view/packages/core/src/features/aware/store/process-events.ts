import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";

import { isExpired } from "../../../lib/api/use-track-utils";

/**
 * Classify a stream event into pendingUpdates or pendingDeletes.
 * Updated entities with lifetime.until in the past are routed to deletes.
 * Mutates the maps in place — same entity is never in both.
 */
export function classifyEvent(
  event: { entity?: Entity; t: EntityChange },
  pendingUpdates: Map<string, Entity>,
  pendingDeletes: Set<string>,
  isExpiredFn: (entity: Entity) => boolean = isExpired,
): void {
  const { entity, t } = event;
  if (!entity?.id) return;

  if (t === EntityChange.EntityChangeUpdated) {
    if (isExpiredFn(entity)) {
      pendingUpdates.delete(entity.id);
      pendingDeletes.add(entity.id);
    } else {
      pendingDeletes.delete(entity.id);
      pendingUpdates.set(entity.id, entity);
    }
  } else if (t === EntityChange.EntityChangeExpired || t === EntityChange.EntityChangeUnobserved) {
    pendingUpdates.delete(entity.id);
    pendingDeletes.add(entity.id);
  }
}
