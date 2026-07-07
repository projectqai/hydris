import { SortField } from "@projectqai/proto/world";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ListMode = "tracks" | "assets";

// "readiness" is a frontend-derived sort (worst readiness blocker), not a proto
// field. it is sorted client-side and never sent to the server.
export type ListSortField = SortField | "readiness";

export type SortConfig = {
  field: ListSortField;
  descending: boolean;
};

type LeftPanelState = {
  listMode: ListMode;
  setListMode: (mode: ListMode) => void;
  sort: SortConfig;
  setSort: (sort: SortConfig) => void;
};

export const DEFAULT_SORT: SortConfig = {
  field: SortField.SortFieldLabel,
  descending: false,
};

export const useLeftPanelStore = create<LeftPanelState>()(
  persist(
    (set) => ({
      listMode: "tracks",
      setListMode: (mode) => set({ listMode: mode }),
      sort: DEFAULT_SORT,
      setSort: (sort) => set({ sort }),
    }),
    {
      name: "hydris-left-panel",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
