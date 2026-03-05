import type { BaseLayer, SceneMode } from "@hydris/map-engine/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type SavedView = { lat: number; lng: number; zoom: number };

type MapState = {
  layer: BaseLayer;
  sceneMode: SceneMode;
  savedView: SavedView | null;
  setLayer: (layer: BaseLayer) => void;
  setSceneMode: (mode: SceneMode) => void;
  setSavedView: (view: SavedView) => void;
};

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      layer: "satellite",
      sceneMode: "3d",
      savedView: null,
      setLayer: (layer) => set({ layer }),
      setSceneMode: (sceneMode) => set({ sceneMode }),
      setSavedView: (savedView) => set({ savedView }),
    }),
    {
      name: "hydris-map",
      storage: {
        getItem: async (name) => {
          const value = await AsyncStorage.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: async (name, value) => {
          await AsyncStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: async (name) => {
          await AsyncStorage.removeItem(name);
        },
      },
    },
  ),
);

export function useMapStoreHydrated() {
  const [hydrated, setHydrated] = useState(useMapStore.persist.hasHydrated());
  useEffect(() => {
    return useMapStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
