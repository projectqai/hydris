import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DEFAULT_OVERLAYS = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: { online: true, degraded: true },
  network: { datalinks: true },
  visualization: {
    coverage: false,
    shapes: true,
    detections: false,
    trackHistory: false,
    clustering: true,
  },
} as const;

type OverlayCategory = keyof typeof DEFAULT_OVERLAYS;

type OverlayState = typeof DEFAULT_OVERLAYS & {
  hiddenLayers: Record<string, true>;
  layerOpacity: Record<string, number>;
  toggle: <K extends OverlayCategory>(
    category: K,
    item: keyof (typeof DEFAULT_OVERLAYS)[K],
  ) => void;
  toggleLayer: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
};

export const useOverlayStore = create<OverlayState>()(
  persist(
    (set) => ({
      ...DEFAULT_OVERLAYS,
      hiddenLayers: {},
      layerOpacity: {},
      toggle: (category, item) =>
        set((state) => ({
          [category]: {
            ...state[category],
            [item]: !state[category][item],
          },
        })),
      toggleLayer: (id) =>
        set((state) => {
          const next = { ...state.hiddenLayers };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { hiddenLayers: next };
        }),
      setLayerOpacity: (id, opacity) =>
        set((state) => ({ layerOpacity: { ...state.layerOpacity, [id]: opacity } })),
    }),
    {
      name: "hydris-overlays",
      storage: createJSONStorage(() => AsyncStorage),
      // deep-merge each category so a toggle added to DEFAULT_OVERLAYS later
      // keeps its default for users with older persisted state. the default
      // shallow merge would replace tracks/sensors/etc. wholesale and read the
      // new key as undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<OverlayState>;
        return {
          ...current,
          ...p,
          tracks: { ...current.tracks, ...p.tracks },
          sensors: { ...current.sensors, ...p.sensors },
          network: { ...current.network, ...p.network },
          visualization: { ...current.visualization, ...p.visualization },
        };
      },
    },
  ),
);
