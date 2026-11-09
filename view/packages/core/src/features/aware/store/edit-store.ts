import { movePathVertex } from "@hydris/map-engine/geometry/rendered-paths";
import type { EditKind, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { create } from "zustand";

import { useEntityStore } from "./entity-store";

export type FinishedEdit = {
  entityId: string;
  kind: EditKind;
  points: PathPoint[];
  rings?: number;
  radiusM?: number;
};

type EditSnapshot = {
  points: PathPoint[];
  rings?: number;
  radiusM?: number;
};

// edits buffer here and push only on End, so a shape is never left half-moved
type EditState = {
  entityId: string | null;
  kind: EditKind;
  points: PathPoint[];
  // rings cannot be re-derived from the points, and end() rewrites the whole shape
  rings: number | undefined;
  radiusM: number | undefined;
  history: EditSnapshot[];
  start: (
    entityId: string,
    kind: EditKind,
    points: readonly PathPoint[],
    rings?: number,
    radiusM?: number,
  ) => void;
  movePoint: (index: number, point: PathPoint) => void;
  insertPoint: (sourceIndex: number, point: PathPoint) => void;
  setRings: (rings: number) => void;
  undo: () => void;
  end: () => FinishedEdit | null;
  cancel: () => void;
};

// an anchored point has no stored position, so geometry changes resolve it
// against wherever its entity is now
export function liveAnchors(points: readonly PathPoint[]): ReadonlyMap<string, GeoPosition> {
  const entities = useEntityStore.getState().entities;
  const positions = new Map<string, GeoPosition>();
  for (const point of points) {
    if (point.type !== "entity") continue;
    const geo = entities.get(point.entityId)?.geo;
    if (geo) {
      positions.set(point.entityId, {
        lat: geo.latitude,
        lng: geo.longitude,
        alt: geo.altitude,
      });
    }
  }
  return positions;
}

export const selectEditPending = (state: EditState) => state.history.length > 0;

export const useEditStore = create<EditState>()((set, get) => ({
  entityId: null,
  kind: "range",
  points: [],
  rings: undefined,
  radiusM: undefined,
  history: [],
  start: (entityId, kind, points, rings, radiusM) =>
    set({ entityId, kind, points: [...points], rings, radiusM, history: [] }),
  movePoint: (index, point) =>
    set((state) => {
      if (state.entityId === null || !state.points[index]) return state;
      const moved = movePathVertex(
        {
          id: state.entityId,
          kind: state.kind,
          points: state.points,
          rings: state.rings,
          radiusM: state.radiusM,
        },
        index,
        point,
        liveAnchors(state.points),
      );
      return {
        points: moved.points,
        radiusM: moved.radiusM,
        history: [
          ...state.history,
          { points: state.points, rings: state.rings, radiusM: state.radiusM },
        ],
      };
    }),
  // a third point changes a stored range's inferred kind, while the other shapes
  // derive geometry from their fixed set of points
  insertPoint: (sourceIndex, point) =>
    set((state) => {
      if (
        state.entityId === null ||
        state.kind !== "freeform" ||
        sourceIndex < 0 ||
        sourceIndex >= state.points.length - 1
      )
        return state;
      return {
        points: [
          ...state.points.slice(0, sourceIndex + 1),
          point,
          ...state.points.slice(sourceIndex + 1),
        ],
        history: [
          ...state.history,
          { points: state.points, rings: state.rings, radiusM: state.radiusM },
        ],
      };
    }),
  setRings: (rings) =>
    set((state) => {
      if (state.entityId === null || state.rings === undefined || state.rings === rings)
        return state;
      return {
        rings,
        history: [
          ...state.history,
          { points: state.points, rings: state.rings, radiusM: state.radiusM },
        ],
      };
    }),
  undo: () =>
    set((state) => {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {
        points: previous.points,
        rings: previous.rings,
        radiusM: previous.radiusM,
        history: state.history.slice(0, -1),
      };
    }),
  end: () => {
    const { entityId, kind, points, rings, radiusM, history } = get();
    set({ entityId: null, points: [], rings: undefined, radiusM: undefined, history: [] });
    return entityId !== null && history.length > 0
      ? {
          entityId,
          kind,
          points,
          ...(rings === undefined ? {} : { rings }),
          ...(radiusM === undefined ? {} : { radiusM }),
        }
      : null;
  },
  cancel: () =>
    set({ entityId: null, points: [], rings: undefined, radiusM: undefined, history: [] }),
}));
