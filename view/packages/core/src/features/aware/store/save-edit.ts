import { updateDrawing } from "../../../lib/api/use-entity-mutation";
import { toast } from "../../../lib/sonner";
import type { FinishedEdit } from "./edit-store";
import { useEntityStore } from "./entity-store";

export async function saveEdit(finished: FinishedEdit | null) {
  if (!finished) return;

  const entity = useEntityStore.getState().entities.get(finished.entityId);
  if (!entity) return;

  try {
    await updateDrawing(entity, finished.kind, finished.points, finished.rings, finished.radiusM);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to save changes");
  }
}
