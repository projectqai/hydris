import type { MeasurementType } from "@hydris/map-engine/types";
import { create } from "zustand";

type MeasurementState = {
  activeMeasurement: MeasurementType | null;
  setActiveMeasurement: (type: MeasurementType | null) => void;
};

export const useMeasurementStore = create<MeasurementState>()((set) => ({
  activeMeasurement: null,
  setActiveMeasurement: (type) => set({ activeMeasurement: type }),
}));
