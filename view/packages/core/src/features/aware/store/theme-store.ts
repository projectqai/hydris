import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type ColorSchemePreference = "dark" | "light" | "system";

type ThemeState = {
  preference: ColorSchemePreference;
  setPreference: (preference: ColorSchemePreference) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "dark",
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: "hydris-theme",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
