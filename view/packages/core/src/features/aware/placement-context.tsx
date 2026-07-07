import type { Entity } from "@projectqai/proto/world";
import { createContext, useContext } from "react";

export type PlacementOptions = { recenter?: boolean };

export type PlacementContextValue = {
  enterPlacement: (entity: Entity, options?: PlacementOptions) => void;
  isPlacing: boolean;
  canPlace: boolean;
};

export const PlacementContext = createContext<PlacementContextValue | null>(null);

export function usePlacement() {
  const ctx = useContext(PlacementContext);
  if (!ctx) throw new Error("usePlacement must be used within PlacementContext.Provider");
  return ctx;
}
