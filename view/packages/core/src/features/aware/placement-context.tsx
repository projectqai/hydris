import type { GeoPosition } from "@hydris/map-engine/types";
import type { Entity } from "@projectqai/proto/world";
import { createContext, useContext } from "react";

export type PlacementOptions = {
  recenter?: boolean;
  recenterAt?: GeoPosition;
  onConfirm?: (position: GeoPosition) => Promise<void>;
};

export type PlacementContextValue = {
  enterPlacement: (entity: Entity, options?: PlacementOptions) => void;
  exitPlacement: () => void;
  isPlacing: boolean;
  canPlace: boolean;
};

export const PlacementContext = createContext<PlacementContextValue | null>(null);

// resetWorld clears every other mode through getState(). placement lives in
// React context, out of its reach, so it goes through this ref
export const placementResetRef: { current: (() => void) | null } = { current: null };

export function usePlacement() {
  const ctx = useContext(PlacementContext);
  if (!ctx) throw new Error("usePlacement must be used within PlacementContext.Provider");
  return ctx;
}
