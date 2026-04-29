import { SortField } from "@projectqai/proto/world";
import { create } from "zustand";

export type ListMode = "tracks" | "assets";

export type SortConfig = {
  field: SortField;
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

export const useLeftPanelStore = create<LeftPanelState>()((set) => ({
  listMode: "tracks",
  setListMode: (mode) => set({ listMode: mode }),
  sort: DEFAULT_SORT,
  setSort: (sort) => set({ sort }),
}));
