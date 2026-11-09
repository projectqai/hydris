import type { BuildShareViewUrlDeps } from "../../../lib/use-url-params";
import { layoutSnapshotRef } from "../hooks/layout-snapshot";
import { useLeftPanelStore } from "../store/left-panel-store";
import { useMapStore } from "../store/map-store";
import { DEFAULT_OVERLAYS, useOverlayStore } from "../store/overlay-store";
import { useSelectionStore } from "../store/selection-store";
import { useTabStore } from "../store/tab-store";

export function shareViewUrlDeps({
  getMapView,
  getTab,
}: Pick<BuildShareViewUrlDeps, "getMapView" | "getTab">): BuildShareViewUrlDeps {
  return {
    getSelectedEntityId: () => useSelectionStore.getState().selectedEntityId,
    getMapView,
    getTab,
    getLayoutSnapshot: () => layoutSnapshotRef.current,
    getOverlayState: () => {
      const overlays = useOverlayStore.getState();

      return {
        tracks: overlays.tracks,
        sensors: overlays.sensors,
        network: overlays.network,
        visualization: overlays.visualization,
      };
    },
    getDefaultOverlays: () => DEFAULT_OVERLAYS,
    getHiddenLayers: () => useOverlayStore.getState().hiddenLayers,
    getLayerOpacity: () => useOverlayStore.getState().layerOpacity,
    getLayer: () => useMapStore.getState().layer,
    getListMode: () => useLeftPanelStore.getState().listMode,
    getDetailTab: () => useTabStore.getState().activeDetailTab,
  };
}
