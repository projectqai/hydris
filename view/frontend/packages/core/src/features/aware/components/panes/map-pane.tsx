"use no memo";

import { useColorScheme } from "nativewind";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import { MapAttribution } from "../../map-search";
import type { MapViewRef } from "../../map-view";
import MapView from "../../map-view";
import {
  selectDetectionEntityIds,
  selectLastChange,
  useEntityStore,
} from "../../store/entity-store";
import {
  registerMapRef,
  setCurrentView,
  unregisterMapRef,
  useMapEngineStore,
} from "../../store/map-engine-store";
import { useMapStore, useMapStoreHydrated } from "../../store/map-store";
import { useOverlayStore } from "../../store/overlay-store";
import { useRangeRingStore } from "../../store/range-ring-store";
import { useSelectionStore } from "../../store/selection-store";
import { buildDelta, buildDeltaChunked } from "../../utils/transform-entities";
import { MapControls } from "./map-controls";

const BRIDGE_CHUNK_SIZE = 5000;
const THROTTLE_MS = 500;

const VIEW_PERSIST_DEBOUNCE_MS = 250;

export function MapPane() {
  const localRef = useRef<MapViewRef>(null);
  const savedView = useMapStore((state) => state.savedView);
  const localViewRef = useRef(savedView ?? { lat: 0, lng: 0, zoom: 2 });
  const viewPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { colorScheme } = useColorScheme();
  const selectedEntityId = useSelectionStore((state) => state.selectedEntityId);
  const isFollowing = useSelectionStore((state) => state.isFollowing);
  const entities = useEntityStore((state) => state.entities);
  const lastChange = useEntityStore(selectLastChange);
  const detectionEntityIds = useEntityStore(selectDetectionEntityIds);
  const baseLayer = useMapStore((state) => state.layer);
  const hydrated = useMapStoreHydrated();
  const tracks = useOverlayStore((state) => state.tracks);
  const sensors = useOverlayStore((state) => state.sensors);
  const visualization = useOverlayStore((state) => state.visualization);
  const rangeRingCenter = useRangeRingStore((s) => s.center);
  const rangeRingsActive = useRangeRingStore((s) => s.isPlacing);
  const primaryRef = useMapEngineStore((s) => s.primaryRef);
  const isPrimary = primaryRef === localRef;

  useEffect(() => {
    registerMapRef(localRef);
    if (savedView) {
      setCurrentView(savedView.lat, savedView.lng, savedView.zoom);
    }
    return () => {
      unregisterMapRef(localRef);
    };
  }, []);

  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushTimeRef = useRef(0);
  const chunkingRef = useRef(false);
  const pendingVersionRef = useRef(false);

  useEffect(() => {
    if (chunkingRef.current) {
      pendingVersionRef.current = true;
      return;
    }

    if (pushTimerRef.current) {
      clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }

    const doPush = () => {
      pushTimerRef.current = null;
      const ref = localRef.current;
      if (!ref || typeof ref.pushDelta !== "function") {
        pushTimerRef.current = setTimeout(doPush, 100);
        return;
      }
      lastPushTimeRef.current = Date.now();

      if (entities.size <= BRIDGE_CHUNK_SIZE) {
        const delta = buildDelta(entities, detectionEntityIds);
        ref.pushDelta(JSON.stringify(delta));
        return;
      }

      const iter = buildDeltaChunked(entities, detectionEntityIds, BRIDGE_CHUNK_SIZE);
      const first = iter.next();

      if (first.done) return;
      ref.pushDelta(JSON.stringify(first.value));

      chunkingRef.current = true;
      pendingVersionRef.current = false;

      const pushNext = () => {
        const next = iter.next();
        if (!next.done) {
          ref.pushDelta(JSON.stringify(next.value));
          setTimeout(pushNext, 0);
        } else {
          chunkingRef.current = false;
          if (pendingVersionRef.current) {
            pendingVersionRef.current = false;
            lastPushTimeRef.current = Date.now();
            const catchup = buildDelta(
              useEntityStore.getState().entities,
              useEntityStore.getState().detectionEntityIds,
            );
            if (catchup.entities.length > 0 || catchup.removed.length > 0) {
              ref.pushDelta(JSON.stringify(catchup));
            }
          }
        }
      };
      pushNext();
    };

    const elapsed = Date.now() - lastPushTimeRef.current;
    if (elapsed >= THROTTLE_MS) {
      doPush();
    } else {
      pushTimerRef.current = setTimeout(doPush, THROTTLE_MS - elapsed);
    }

    return () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [lastChange.version]);

  const trackedId = isFollowing && selectedEntityId ? selectedEntityId : null;
  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = localRef.current;
      if (!ref || typeof ref.pushSelection !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushSelection(selectedEntityId, trackedId);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [selectedEntityId, trackedId]);

  const filterJson = JSON.stringify({ tracks, sensors });
  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = localRef.current;
      if (!ref || typeof ref.pushSettings !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushSettings(
        baseLayer,
        filterJson,
        visualization.coverage,
        visualization.shapes,
        visualization.detections,
        visualization.trackHistory,
      );
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [
    baseLayer,
    filterJson,
    visualization.coverage,
    visualization.shapes,
    visualization.detections,
    visualization.trackHistory,
  ]);

  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = localRef.current;
      if (!ref || typeof ref.pushRangeRing !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushRangeRing(rangeRingCenter ? JSON.stringify(rangeRingCenter) : null, rangeRingsActive);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [rangeRingCenter, rangeRingsActive]);

  useEffect(() => {
    if (!selectedEntityId) return;
    const gone = lastChange.fullClear
      ? !entities.has(selectedEntityId)
      : lastChange.deletedIds.has(selectedEntityId);
    if (gone) useSelectionStore.getState().clearSelection();
  }, [selectedEntityId, lastChange]);

  const handleMapClick = async (lat: number, lng: number) => {
    useRangeRingStore.getState().setCenter(lat, lng);
  };

  const handleEntityClick = async (id: string | null) => {
    const { selectedEntityId: sel, select } = useSelectionStore.getState();
    if (id) {
      select(sel === id ? null : id);
    } else if (sel) {
      select(null);
    }
  };

  const flyToTarget = useMapEngineStore((s) => (isPrimary ? s.flyToTarget : null));
  const zoomCommand = useMapEngineStore((s) => (isPrimary ? s.zoomCommand : null));

  if (!hydrated) {
    return <View style={{ flex: 1 }} className="bg-background" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <View className="bg-background flex-1">
        <MapView
          dom={{ style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } }}
          ref={localRef}
          flyToTarget={flyToTarget}
          zoomCommand={zoomCommand}
          baseLayer={baseLayer}
          colorScheme={colorScheme ?? "dark"}
          bgColor="rgb(22, 22, 22)"
          initialLat={savedView?.lat}
          initialLng={savedView?.lng}
          initialZoom={savedView?.zoom}
          coverageVisible={visualization.coverage}
          shapesVisible={visualization.shapes}
          detectionsVisible={visualization.detections}
          trackHistoryVisible={visualization.trackHistory}
          onEntityClick={handleEntityClick}
          onMapClick={handleMapClick}
          onTrackingLost={async () => useSelectionStore.setState({ isFollowing: false })}
          onViewChange={async (lat, lng, zoom) => {
            localViewRef.current = { lat, lng, zoom };
            if (isPrimary) {
              setCurrentView(lat, lng, zoom);
              if (viewPersistTimer.current) clearTimeout(viewPersistTimer.current);
              viewPersistTimer.current = setTimeout(() => {
                useMapStore.getState().setSavedView({ lat, lng, zoom });
              }, VIEW_PERSIST_DEBOUNCE_MS);
            }
          }}
        />
      </View>
      <View
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
        pointerEvents="box-none"
      >
        <MapControls mapRef={localRef} viewRef={localViewRef} />
        <MapAttribution />
      </View>
    </View>
  );
}
