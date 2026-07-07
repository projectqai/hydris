import { useSyncExternalStore } from "react";

type PersistApi = {
  hasHydrated: () => boolean;
  onFinishHydration: (callback: () => void) => () => void;
};

export function useStoreHydrated(persist: PersistApi): boolean {
  return useSyncExternalStore(persist.onFinishHydration, persist.hasHydrated);
}
