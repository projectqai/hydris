import { useEntityStore } from "../store/entity-store";
import { mapEngineActions } from "../store/map-engine-store";
import { useSelectionStore } from "../store/selection-store";

export function focusEntity(entityId: string) {
  useSelectionStore.getState().select(entityId);

  const geo = useEntityStore.getState().entities.get(entityId)?.geo;
  if (!geo) return;

  const currentZoom = mapEngineActions.getView()?.zoom ?? 10;
  mapEngineActions.flyTo(
    geo.latitude,
    geo.longitude,
    geo.altitude ?? 0,
    1.5,
    Math.max(currentZoom, 14),
  );
}
