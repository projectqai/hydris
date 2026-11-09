import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";

import { pushPath } from "../../../lib/api/use-entity-mutation";
import { toast } from "../../../lib/sonner";
import { TOOL } from "../utils/map-paths";
import { usePathStore } from "./path-store";
import { useSelectionStore } from "./selection-store";

export async function savePath(finished: MapPath | null) {
  if (!finished) return;

  try {
    const entityId = await pushPath(finished);
    usePathStore.getState().markSaved(finished.id, entityId);
    // finishing a shape is the same act as picking one, so its details are open
    // without having to hunt for what was just drawn
    useSelectionStore.getState().select(entityId);
  } catch (err) {
    usePathStore.getState().remove(finished.id);
    const detail = err instanceof Error ? `: ${err.message}` : "";
    toast.error(`Failed to save ${TOOL[finished.kind].label}${detail}`);
  }
}
