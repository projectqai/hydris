import type { GeoPosition } from "@hydris/map-engine/types";
import { create } from "zustand";

type RangeRingState = {
  center: GeoPosition | null;
  isPlacing: boolean;
  setCenter: (lat: number, lng: number) => void;
  togglePlacing: () => void;
  clear: () => void;
};

export const useRangeRingStore = create<RangeRingState>()((set, get) => ({
  center: null,
  isPlacing: false,
  setCenter: (lat, lng) => set({ center: { lat, lng }, isPlacing: false }),
  togglePlacing: () => {
    const { isPlacing, center } = get();
    if (isPlacing || center) {
      set({ isPlacing: false, center: null });
    } else {
      set({ isPlacing: true });
    }
  },
  clear: () => set({ center: null, isPlacing: false }),
}));
