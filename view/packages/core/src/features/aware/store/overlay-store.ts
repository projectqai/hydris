import { create } from "zustand";

export const DEFAULT_OVERLAYS = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: { online: true, degraded: true },
  network: { datalinks: true },
  visualization: { coverage: false, shapes: true, detections: false, trackHistory: false },
} as const;

type OverlayCategory = keyof typeof DEFAULT_OVERLAYS;

type OverlayState = typeof DEFAULT_OVERLAYS & {
  toggle: <K extends OverlayCategory>(
    category: K,
    item: keyof (typeof DEFAULT_OVERLAYS)[K],
  ) => void;
};

export const useOverlayStore = create<OverlayState>()((set) => ({
  ...DEFAULT_OVERLAYS,
  toggle: (category, item) =>
    set((state) => ({
      [category]: {
        ...state[category],
        [item]: !state[category][item],
      },
    })),
}));
