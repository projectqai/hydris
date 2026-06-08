import { create } from "zustand";

type OpenState = {
  readonly entityId: string | null;
  readonly x: number;
  readonly y: number;
  readonly lat: number;
  readonly lng: number;
};

type RadialMenuStore = {
  readonly open: OpenState | null;
  readonly openFor: (
    entityId: string | null,
    x: number,
    y: number,
    lat: number,
    lng: number,
  ) => void;
  readonly close: () => void;
};

export const useRadialMenuStore = create<RadialMenuStore>((set) => ({
  open: null,
  openFor: (entityId, x, y, lat, lng) => set({ open: { entityId, x, y, lat, lng } }),
  close: () => set({ open: null }),
}));
