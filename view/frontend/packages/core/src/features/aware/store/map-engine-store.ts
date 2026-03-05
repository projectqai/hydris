import type { RefObject } from "react";
import { create } from "zustand";

import type { MapViewRef } from "../map-view";
import { resetDeltaState } from "../utils/transform-entities";

export type FlyToTarget = {
  lat: number;
  lng: number;
  alt?: number;
  duration?: number;
  zoom?: number;
  commandId: number;
} | null;
export type ZoomCommand = string | null;

type ViewState = { lat: number; lng: number; zoom: number };

type MapEngineState = {
  primaryRef: RefObject<MapViewRef | null> | null;
  isReady: boolean;
  flyToTarget: FlyToTarget;
  zoomCommand: ZoomCommand;
  currentView: ViewState;
};

const DEFAULT_VIEW: ViewState = { lat: 0, lng: 0, zoom: 2 };

const registeredRefs: RefObject<MapViewRef | null>[] = [];

export const useMapEngineStore = create<MapEngineState>()(() => ({
  primaryRef: null,
  isReady: false,
  flyToTarget: null,
  zoomCommand: null,
  currentView: DEFAULT_VIEW,
}));

export function registerMapRef(ref: RefObject<MapViewRef | null>) {
  if (registeredRefs.includes(ref)) return;
  registeredRefs.push(ref);
  resetDeltaState();
  if (registeredRefs.length === 1) {
    useMapEngineStore.setState({ primaryRef: ref });
  }
}

export function unregisterMapRef(ref: RefObject<MapViewRef | null>) {
  const idx = registeredRefs.indexOf(ref);
  if (idx === -1) return;
  registeredRefs.splice(idx, 1);
  const currentPrimary = useMapEngineStore.getState().primaryRef;
  if (currentPrimary === ref) {
    useMapEngineStore.setState({ primaryRef: registeredRefs[0] ?? null });
  }
}

export function setCurrentView(lat: number, lng: number, zoom: number) {
  useMapEngineStore.setState({ currentView: { lat, lng, zoom } });
}

export function setMapReady(ready: boolean) {
  useMapEngineStore.setState({ isReady: ready });
}

export function useMapRef() {
  return useMapEngineStore((s) => s.primaryRef);
}

export function useFlyToTarget() {
  return useMapEngineStore((s) => s.flyToTarget);
}

export function clearFlyToTarget() {
  useMapEngineStore.setState({ flyToTarget: null });
}

export function useZoomCommand() {
  return useMapEngineStore((s) => s.zoomCommand);
}

const getRef = () => useMapEngineStore.getState().primaryRef?.current ?? null;

let flyToCommandId = 0;

export const mapEngineActions = {
  zoomIn: () => getRef()?.zoomIn(),
  zoomOut: () => getRef()?.zoomOut(),
  flyTo: (lat: number, lng: number, alt?: number, duration?: number, zoom?: number) => {
    const ref = getRef();
    if (ref) {
      ref.flyTo(lat, lng, alt, duration, zoom);
    } else {
      useMapEngineStore.setState({
        flyToTarget: { lat, lng, alt, duration, zoom, commandId: ++flyToCommandId },
      });
    }
  },
  getView: () => useMapEngineStore.getState().currentView,
};

export function useMapEngine() {
  return mapEngineActions;
}
