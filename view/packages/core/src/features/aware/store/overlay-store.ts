import { create } from "zustand";

export const DEFAULT_OVERLAYS = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: { online: true, degraded: true },
  network: { datalinks: true },
  visualization: { coverage: false, shapes: true, detections: false, trackHistory: false },
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

export const useOverlayStore = create<OverlayState>()((set) => ({
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
}));
