import {
  capturePathRadius,
  type MapPath,
  movePathVertex,
} from "@hydris/map-engine/geometry/rendered-paths";
import type { DrawingKind, EditKind, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { create } from "zustand";

import {
  DEFAULT_RINGS,
  endsOnADuplicate,
  hasEnoughPoints,
  placementEnds,
  pointsRemaining,
  removePath,
  TOOL,
} from "../utils/map-paths";

export type { MapPath };

type PathState = {
  paths: MapPath[];
  drawingId: string | null;
  start: (kind: DrawingKind) => void;
  toggleActive: () => MapPath | null;
  addPoint: (
    point: PathPoint,
    anchorPositions?: ReadonlyMap<string, GeoPosition>,
  ) => MapPath | null;
  finish: () => MapPath | null;
  finishByGesture: () => MapPath | null;
  movePoint: (pathId: string, index: number, point: PathPoint) => void;
  updateAnchorPositions: (positions: ReadonlyMap<string, GeoPosition>) => void;
  setRings: (rings: number) => void;
  markSaved: (pathId: string, entityId: string) => void;
  remove: (pathId: string) => void;
  undo: () => void;
  cancel: () => void;
  clear: () => void;
};

const drawingOf = (state: PathState) => state.paths.find((path) => path.id === state.drawingId);

export const selectPathKind = (state: PathState) => drawingOf(state)?.kind ?? null;

export const selectPathPointCount = (state: PathState) => drawingOf(state)?.points.length ?? 0;

export const selectPathPointsRemaining = (state: PathState) => pointsRemaining(drawingOf(state));

export const selectPathRings = (state: PathState) => drawingOf(state)?.rings;

export const selectCanFinishPath = (state: PathState) => {
  const drawing = drawingOf(state);
  return drawing !== undefined && hasEnoughPoints(drawing);
};

let rangeSequence = 0;
let drawingSequence = 0;

function createPath(kind: EditKind): MapPath {
  const id = kind === "range" ? String(++rangeSequence) : `drawing-${++drawingSequence}`;
  return {
    id,
    kind,
    points: [],
    ...(TOOL[kind].rings ? { rings: DEFAULT_RINGS } : {}),
  };
}

export const usePathStore = create<PathState>()((set, get) => ({
  paths: [],
  drawingId: null,
  start: (kind) => {
    const drawing = createPath(kind);
    set((state) => ({
      paths: [...removePath(state.paths, state.drawingId), drawing],
      drawingId: drawing.id,
    }));
  },
  toggleActive: () => {
    if (get().drawingId !== null) return get().finish();
    const path = createPath("range");
    set((state) => ({ paths: [...state.paths, path], drawingId: path.id }));
    return null;
  },
  addPoint: (point, anchorPositions = new Map()) => {
    const { drawingId, paths } = get();
    if (drawingId === null) return null;
    const drawing = drawingOf(get());
    if (!drawing || (drawing.kind === "range" && placementEnds(drawing))) return null;

    const placed = { ...drawing, points: [...drawing.points, point] };
    const finished = placementEnds(placed) ? capturePathRadius(placed, anchorPositions) : null;
    set({
      paths: paths.map((path) => (path.id === drawingId ? (finished ?? placed) : path)),
      drawingId: finished ? null : drawingId,
    });
    return finished;
  },
  finish: () => {
    const drawingId = get().drawingId;
    if (drawingId === null) return null;

    const drawing = drawingOf(get());
    const finished = drawing && hasEnoughPoints(drawing) ? drawing : null;
    set((state) => ({
      paths: finished ? state.paths : removePath(state.paths, drawingId),
      drawingId: null,
    }));
    return finished;
  },
  finishByGesture: () => {
    const drawing = drawingOf(get());
    if (drawing && endsOnADuplicate(drawing)) get().undo();
    return get().finish();
  },
  movePoint: (pathId, index, point) =>
    set((state) => ({
      paths: state.paths.map((path) =>
        path.id === pathId && path.points[index] ? movePathVertex(path, index, point) : path,
      ),
    })),
  updateAnchorPositions: (positions) =>
    set((state) => {
      let changed = false;
      const paths = state.paths.map((path) => {
        if (path.kind !== "range") return path;
        let pathChanged = false;
        const points = path.points.map((point) => {
          if (point.type !== "entity") return point;
          const position = positions.get(point.entityId);
          if (!position) return point;
          const lastKnownPosition = point.lastKnownPosition;
          if (
            lastKnownPosition?.lat === position.lat &&
            lastKnownPosition.lng === position.lng &&
            lastKnownPosition.alt === position.alt
          ) {
            return point;
          }
          changed = true;
          pathChanged = true;
          return { ...point, lastKnownPosition: position };
        });
        return pathChanged ? { ...path, points } : path;
      });
      return changed ? { paths } : state;
    }),
  setRings: (rings) =>
    set((state) => ({
      paths: state.paths.map((path) => (path.id === state.drawingId ? { ...path, rings } : path)),
    })),
  markSaved: (pathId, entityId) =>
    set((state) => ({
      paths: state.paths.map((path) =>
        path.id === pathId ? { ...path, savedAs: entityId } : path,
      ),
    })),
  remove: (pathId) => set((state) => ({ paths: removePath(state.paths, pathId) })),
  undo: () =>
    set((state) => ({
      paths: state.paths.map((path) =>
        path.id === state.drawingId ? { ...path, points: path.points.slice(0, -1) } : path,
      ),
    })),
  cancel: () =>
    set((state) => ({ paths: removePath(state.paths, state.drawingId), drawingId: null })),
  clear: () =>
    set((state) => {
      const active = drawingOf(state);
      if (!active) return { paths: [] };
      const restarted = createPath(active.kind);
      return { paths: [restarted], drawingId: restarted.id };
    }),
}));
