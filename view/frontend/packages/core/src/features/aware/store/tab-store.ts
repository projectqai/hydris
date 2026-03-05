import { create } from "zustand";

type TabState = {
  initialTab: string | null;
  activeDetailTab: string;
  setInitialTab: (tab: string | null) => void;
  setActiveDetailTab: (tab: string) => void;
  clearInitialTab: () => void;
};

export const useTabStore = create<TabState>()((set) => ({
  initialTab: null,
  activeDetailTab: "overview",
  setInitialTab: (tab) => set({ initialTab: tab }),
  setActiveDetailTab: (tab) => set({ activeDetailTab: tab }),
  clearInitialTab: () => set({ initialTab: null }),
}));
