import type { MissionPack } from "@projectqai/proto/world";
import { create } from "zustand";

import { worldClient } from "../../lib/api/world-client";

type MissionHealthState = {
  mission: MissionPack | null;
  fetch: () => Promise<void>;
  clear: () => void;
};

export const useMissionHealthStore = create<MissionHealthState>((set) => ({
  mission: null,
  fetch: async () => {
    try {
      const res = await worldClient.getLocalNode({});
      set({ mission: res.entity?.device?.node?.mission ?? null });
    } catch {
      // engine not reachable
    }
  },
  clear: () => set({ mission: null }),
}));
