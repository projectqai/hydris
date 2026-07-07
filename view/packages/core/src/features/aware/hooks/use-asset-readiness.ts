"use no memo";

import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { isAsset } from "../../../lib/api/use-track-utils";
import { useEntityStore } from "../store/entity-store";
import { deriveAssetReadiness } from "../utils/asset-readiness";

export function useAssets(): Entity[] {
  return useEntityStore(
    useShallow((s) => {
      const result: Entity[] = [];
      for (const entity of s.entities.values()) {
        if (isAsset(entity)) result.push(entity);
      }
      return result;
    }),
  );
}

export function useNotReadyCounts(): { notReady: number; failed: number } {
  return useEntityStore(
    useShallow((s) => {
      let notReady = 0;
      let failed = 0;
      for (const entity of s.entities.values()) {
        if (!isAsset(entity)) continue;
        const r = deriveAssetReadiness(entity);
        if (!r.ready) notReady++;
        if (r.failed) failed++;
      }
      return { notReady, failed };
    }),
  );
}
