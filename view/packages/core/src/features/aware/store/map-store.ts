import type { BaseLayer, SceneMode } from "@hydris/map-engine/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type SavedView = { lat: number; lng: number; zoom: number };

export type CoordFormat = "latlng" | "mgrs";

type MapState = {
  layer: BaseLayer;
  offlineBasemapId: string | null;
  sceneMode: SceneMode;
  savedView: SavedView | null;
  coordEntryFormat: CoordFormat;
  setLayer: (layer: BaseLayer) => void;
  setOfflineBasemap: (id: string | null) => void;
  setSceneMode: (mode: SceneMode) => void;
  setSavedView: (view: SavedView) => void;
  setCoordEntryFormat: (format: CoordFormat) => void;
};

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      layer: "satellite",
      offlineBasemapId: null,
      sceneMode: "3d",
      savedView: null,
      coordEntryFormat: "latlng",
      setLayer: (layer) => set({ layer, offlineBasemapId: null }),
      setOfflineBasemap: (offlineBasemapId) => set({ offlineBasemapId }),
      setSceneMode: (sceneMode) => set({ sceneMode }),
      setSavedView: (savedView) => set({ savedView }),
      setCoordEntryFormat: (coordEntryFormat) => set({ coordEntryFormat }),
    }),
    {
      name: "hydris-map",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
