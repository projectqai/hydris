import { create } from "zustand";

type TabState = {
  initialTab: string | null;
  activeDetailTab: string;
  clearInitialTab: () => void;
};

export const useTabStore = create<TabState>()((set) => ({
  initialTab: null,
  activeDetailTab: "overview",
  clearInitialTab: () => set({ initialTab: null }),
}));
