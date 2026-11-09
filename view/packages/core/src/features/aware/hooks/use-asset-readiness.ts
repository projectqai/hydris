"use no memo";

import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { isAsset } from "../../../lib/api/use-track-utils";
import { useEntityStore } from "../store/entity-store";

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
