"use no memo";

import type { ActiveTool } from "@hydris/map-engine/adapters/maplibre";
import { movePathPoint } from "@hydris/map-engine/geometry/path-geometry";
import type { GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { useEntityMutation } from "../../../../lib/api/use-entity-mutation";
import { toast } from "../../../../lib/sonner";
import { MapAttribution } from "../../map-search";
import type { MapViewRef } from "../../map-view";
import MapView from "../../map-view";
import { usePlacement } from "../../placement-context";
import { useBullseyeStore } from "../../store/bullseye-store";
import { liveAnchors, useEditStore } from "../../store/edit-store";
import {
  selectDetectionEntityIds,
  selectLastChange,
  useEntityStore,
} from "../../store/entity-store";
import {
  clearFlyToTarget,
  registerMapRef,
  setCurrentView,
  setPointerType,
  unregisterMapRef,
  useMapEngineStore,
} from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { useOverlayStore } from "../../store/overlay-store";
import { selectPathKind, usePathStore } from "../../store/path-store";
import { useRadialMenuStore } from "../../store/radial-menu-store";
import { saveEdit } from "../../store/save-edit";
import { savePath } from "../../store/save-path";
import { useSelectionStore } from "../../store/selection-store";
import { useStoreHydrated } from "../../store/use-store-hydrated";
import {
  buildDelta,
  buildDeltaChunked,
  readPathPoints,
  transformEntity,
} from "../../utils/transform-entities";
import { RadialMenuController } from "../radial-menu/radial-menu-controller";
import { MapControls } from "./map-controls";
import { MapStepLine } from "./map-step-line";

const BRIDGE_CHUNK_SIZE = 5000;
const THROTTLE_MS = 500;

const VIEW_PERSIST_DEBOUNCE_MS = 250;

async function handlePathInsert(pathId: string, sourceIndex: number, pointJson: string) {
  const edit = useEditStore.getState();
  if (pathId !== edit.entityId) return;
  const point: PathPoint = JSON.parse(pointJson);
  edit.insertPoint(sourceIndex, point);
}

export function MapPane() {
  const localRef = useRef<MapViewRef>(null);
  const paneViewRef = useRef<View | null>(null);
  const paneOffsetRef = useRef({ x: 0, y: 0 });
  const savedView = useMapStore((state) => state.savedView);
  const localViewRef = useRef(savedView ?? { lat: 0, lng: 0, zoom: 2 });
  const viewPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { colorScheme } = useColorScheme();
  const selectedEntityId = useSelectionStore((state) => state.selectedEntityId);
  const isFollowing = useSelectionStore((state) => state.isFollowing);
  const entities = useEntityStore((state) => state.entities);
  const lastChange = useEntityStore(selectLastChange);
  const detectionEntityIds = useEntityStore(selectDetectionEntityIds);
  const offlineBasemapId = useMapStore((state) => state.offlineBasemapId);
  const layer = useMapStore((state) => state.layer);
  const baseLayer = offlineBasemapId && entities.has(offlineBasemapId) ? offlineBasemapId : layer;
  const hydrated = useStoreHydrated(useMapStore.persist);
  const tracks = useOverlayStore((state) => state.tracks);
  const sensors = useOverlayStore((state) => state.sensors);
  const visualization = useOverlayStore((state) => state.visualization);
  const hiddenLayers = useOverlayStore((state) => state.hiddenLayers);
  const layerOpacity = useOverlayStore((state) => state.layerOpacity);
  const bullseyeCenter = useBullseyeStore((s) => s.center);
  const bullseyePlacing = useBullseyeStore((s) => s.isPlacing);
  const paths = usePathStore((state) => state.paths);
  const drawingId = usePathStore((state) => state.drawingId);
  const pathKind = usePathStore(selectPathKind);
  const anchorablePaths = useMemo(() => paths.filter((path) => path.kind === "range"), [paths]);
  const rangeAnchorEntities = useEntityStore(
    useShallow((state) =>
      anchorablePaths.flatMap((path) =>
        path.points.map((point) =>
          point.type === "entity" ? state.entities.get(point.entityId) : undefined,
        ),
      ),
    ),
  );
  const { updateRb } = useEntityMutation();
  const drawingKind = pathKind === "range" ? null : pathKind;
  const editingEntityId = useEditStore((state) => state.entityId);
  const editingEntityExists = useEntityStore(
    (state) => editingEntityId === null || state.entities.has(editingEntityId),
  );
  const editingPoints = useEditStore((state) => state.points);
  const editingKind = useEditStore((state) => state.kind);
  const editingRings = useEditStore((state) => state.rings);
  const editingRadiusM = useEditStore((state) => state.radiusM);
  const activeTool: ActiveTool =
    pathKind === "range"
      ? "range"
      : bullseyePlacing
        ? "bullseye"
        : drawingKind
          ? "drawing"
          : "none";
  const primaryRef = useMapEngineStore((s) => s.primaryRef);
  const isPrimary = primaryRef === localRef;
  const { isPlacing } = usePlacement();
  const t = useThemeColors();
  const placementCoordColors = useMemo(
    () => ({ bg: t.paneHeaderBg, border: t.borderSubtle, text: t.foreground }),
    [t.paneHeaderBg, t.borderSubtle, t.foreground],
  );

  useEffect(() => {
    const positions = new Map<string, GeoPosition>();
    let index = 0;
    for (const path of anchorablePaths) {
      for (const point of path.points) {
        const entity = rangeAnchorEntities[index];
        index += 1;
        if (point.type !== "entity" || !entity) continue;
        const position = transformEntity(entity)?.position;
        if (position) positions.set(point.entityId, position);
      }
    }
    usePathStore.getState().updateAnchorPositions(positions);
  }, [rangeAnchorEntities, anchorablePaths]);

  const unmountedRef = useRef(false);

  useEffect(() => {
    registerMapRef(localRef);
    if (savedView) {
      setCurrentView(savedView.lat, savedView.lng, savedView.zoom);
    }
    return () => {
      unmountedRef.current = true;
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
        if (unmountedRef.current) {
          chunkingRef.current = false;
          return;
        }
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

    // without the bypass your own edit waits up to 500ms to redraw
    const elapsed = Date.now() - lastPushTimeRef.current;
    if (lastChange.local || elapsed >= THROTTLE_MS) {
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
        visualization.clustering,
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
    visualization.clustering,
  ]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      if (cancelled) return;
      retryTimer = null;
      const ref = localRef.current;
      if (!ref || typeof ref.pushBullseye !== "function") {
        retryTimer = setTimeout(push, 100);
        return;
      }
      ref.pushBullseye(bullseyeCenter ? JSON.stringify(bullseyeCenter) : null);
    };
    push();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [bullseyeCenter]);

  const editedPaths =
    editingEntityId && editingPoints.length
      ? [
          {
            id: editingEntityId,
            kind: editingKind,
            points: editingPoints,
            rings: editingRings,
            radiusM: editingRadiusM,
          },
        ]
      : [];
  const pathsJson = JSON.stringify([...paths, ...editedPaths]);
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      if (cancelled) return;
      retryTimer = null;
      const ref = localRef.current;
      if (!ref || typeof ref.pushPaths !== "function") {
        retryTimer = setTimeout(push, 100);
        return;
      }
      ref.pushPaths(pathsJson, drawingId, activeTool, editingEntityId);
    };
    push();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [pathsJson, drawingId, activeTool, editingEntityId]);

  const hiddenLayersJson = JSON.stringify(Object.keys(hiddenLayers));
  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = localRef.current;
      if (!ref || typeof ref.pushHiddenLayers !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushHiddenLayers(hiddenLayersJson);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [hiddenLayersJson]);

  const layerOpacityJson = JSON.stringify(layerOpacity);
  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = localRef.current;
      if (!ref || typeof ref.pushLayerOpacity !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushLayerOpacity(layerOpacityJson);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [layerOpacityJson]);

  useEffect(() => {
    if (!selectedEntityId) return;
    const gone = lastChange.fullClear
      ? !entities.has(selectedEntityId)
      : lastChange.deletedIds.has(selectedEntityId);
    if (gone) useSelectionStore.getState().clearSelection();
  }, [selectedEntityId, lastChange]);

  // The working copy renders in place of the stored shape, so an edit outlasting
  // its entity leaves the shape on the map after it has been deleted.
  useEffect(() => {
    if (!editingEntityExists) useEditStore.getState().cancel();
  }, [editingEntityExists]);

  const handleMapClick = async (pointJson: string) => {
    const point: PathPoint = JSON.parse(pointJson);
    if (activeTool === "range") {
      await savePath(usePathStore.getState().addPoint(point));
    } else if (activeTool === "bullseye" && point.type === "coordinate") {
      useBullseyeStore.getState().setCenter(point.position.lat, point.position.lng);
    } else if (drawingKind) {
      const pathState = usePathStore.getState();
      const drawing = pathState.paths.find((candidate) => candidate.id === pathState.drawingId);
      const anchorPositions = liveAnchors([...(drawing?.points ?? []), point]);
      await savePath(pathState.addPoint(point, anchorPositions));
    }
  };

  const handleSavedPathsArrived = async (pathIdsJson: string) => {
    const pathIds: string[] = JSON.parse(pathIdsJson);
    for (const pathId of pathIds) {
      usePathStore.getState().remove(pathId);
    }
  };

  const handleDoubleClickFinish = async () => {
    const edit = useEditStore.getState();
    if (edit.entityId) {
      await saveEdit(edit.end());
      return;
    }
    const path = usePathStore.getState();
    if (!path.drawingId || selectPathKind(path) === "range") return;
    await savePath(path.finishByGesture());
  };

  const handlePathCommit = async (pathId: string, sourceIndex: number, pointJson: string) => {
    const point: PathPoint = JSON.parse(pointJson);
    if (pathId === useEditStore.getState().entityId) {
      useEditStore.getState().movePoint(sourceIndex, point);
      return;
    }

    const entity = useEntityStore.getState().entities.get(pathId);
    const current = entity && readPathPoints(entity);
    if (!entity || !current) {
      usePathStore.getState().movePoint(pathId, sourceIndex, point);
      return;
    }

    try {
      await updateRb(entity, movePathPoint(current, sourceIndex, point));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move range and bearing point");
      throw err;
    }
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
      <View
        ref={paneViewRef}
        className="bg-background flex-1"
        onLayout={() => {
          paneViewRef.current?.measureInWindow((x, y) => {
            paneOffsetRef.current = { x, y };
          });
        }}
      >
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
          clusteringEnabled={visualization.clustering}
          isPlacing={isPlacing && isPrimary}
          placementCoordColors={placementCoordColors}
          onEntityClick={handleEntityClick}
          onMapClick={handleMapClick}
          onPathCommit={handlePathCommit}
          onPathInsert={handlePathInsert}
          onDoubleClickFinish={handleDoubleClickFinish}
          onSavedPathsArrived={handleSavedPathsArrived}
          onRadialRequest={async (entityId, screenX, screenY, lat, lng) => {
            if (!isPrimary) return;
            if (entityId) {
              const selection = useSelectionStore.getState();
              if (selection.selectedEntityId !== entityId) selection.select(entityId);
            }
            const offset = paneOffsetRef.current;
            useRadialMenuStore
              .getState()
              .openFor(entityId, screenX + offset.x, screenY + offset.y, lat, lng);
          }}
          onTrackingLost={async () => useSelectionStore.setState({ isFollowing: false })}
          onPointerTypeChange={async (pointerType) => {
            setPointerType(pointerType);
          }}
          onViewChange={async (lat, lng, zoom) => {
            localViewRef.current = { lat, lng, zoom };
            if (isPrimary) {
              setCurrentView(lat, lng, zoom);
              // drop the consumed target so a layout remount can't re-fire it
              if (useMapEngineStore.getState().flyToTarget) clearFlyToTarget();
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
        {isPrimary && <MapStepLine />}
      </View>
      {isPrimary && <RadialMenuController />}
    </View>
  );
}
