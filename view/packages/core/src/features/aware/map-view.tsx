"use dom";

import type { ActiveTool, MapActions } from "@hydris/map-engine/adapters/maplibre";
import { MapView as MapAdapter } from "@hydris/map-engine/adapters/maplibre";
import {
  collectRenderedPaths,
  hasDragLanded,
  livePositions,
  type MapPath,
  movePathVertex,
  reconcileEditDragOverride,
} from "@hydris/map-engine/geometry/rendered-paths";
import type { EntityData, EntityFilter, GeoPosition, PathPoint } from "@hydris/map-engine/types";
import { geodesicDistance, slantRangeAndElevation } from "@hydris/map-engine/utils/geodesy";
import type { DOMProps } from "expo/dom";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef, useState } from "react";

import { calculateVerticalRate, formatRangeReadout } from "./utils/format-kinematics";
import { arrivedPathIds } from "./utils/map-paths";
import { buildPathLayerData } from "./utils/path-layer-data";
import {
  deserializeEntity,
  type SerializedDelta,
  type SerializedEntityData,
} from "./utils/transform-entities";

export interface MapViewRef {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lng: number, alt?: number, duration?: number, zoom?: number) => void;
  pushDelta: (deltaJson: string) => void;
  pushSelection: (selectedId: string | null, trackedId: string | null) => void;
  pushSettings: (
    baseLayer: string,
    filterJson: string,
    coverageVisible: boolean,
    shapesVisible: boolean,
    detectionsVisible: boolean,
    trackHistoryVisible: boolean,
    clusteringEnabled: boolean,
  ) => void;
  pushBullseye: (centerJson: string | null) => void;
  pushPaths: (
    pathsJson: string,
    drawingId: string | null,
    activeTool: ActiveTool,
    editablePathId: string | null,
  ) => void;
  pushHiddenLayers: (idsJson: string) => void;
  pushLayerOpacity: (json: string) => void;
}

type FlyToTarget = {
  lat: number;
  lng: number;
  alt?: number;
  duration?: number;
  zoom?: number;
  commandId: number;
} | null;
type ZoomCommand = string | null;

function getRangePreviewLabel(source: GeoPosition, target: GeoPosition): string {
  const sourceGeo = { latitude: source.lat, longitude: source.lng };
  const targetGeo = { latitude: target.lat, longitude: target.lng };
  const slantDistanceM =
    source.alt === undefined || target.alt === undefined
      ? null
      : slantRangeAndElevation(
          { ...sourceGeo, altitude: source.alt },
          { ...targetGeo, altitude: target.alt },
        ).slantDistanceM;
  return formatRangeReadout(geodesicDistance(sourceGeo, targetGeo), slantDistanceM);
}

type MapViewProps = {
  ref: Ref<MapViewRef>;
  filterJson?: string;
  flyToTarget?: FlyToTarget;
  zoomCommand?: ZoomCommand;
  baseLayer?: string;
  colorScheme?: "dark" | "light";
  bgColor?: string;
  initialLat?: number;
  initialLng?: number;
  initialZoom?: number;
  coverageVisible?: boolean;
  shapesVisible?: boolean;
  detectionsVisible?: boolean;
  trackHistoryVisible?: boolean;
  clusteringEnabled?: boolean;
  isPlacing?: boolean;
  placementCoordColors?: { bg: string; border: string; text: string };
  onReady?: () => Promise<void>;
  onEntityClick?: (id: string | null) => Promise<void>;
  onMapClick?: (pointJson: string) => Promise<void>;
  onPathCommit?: (pathId: string, sourceIndex: number, pointJson: string) => Promise<void>;
  onPathInsert?: (pathId: string, sourceIndex: number, pointJson: string) => Promise<void>;
  onDoubleClickFinish?: () => Promise<void>;
  onSavedPathsArrived?: (pathIdsJson: string) => Promise<void>;
  onRadialRequest?: (
    entityId: string | null,
    screenX: number,
    screenY: number,
    lat: number,
    lng: number,
  ) => Promise<void>;
  onTrackingLost?: () => Promise<void>;
  onViewChange?: (lat: number, lng: number, zoom: number) => Promise<void>;
  onPointerTypeChange?: (pointerType: string) => Promise<void>;
  dom?: DOMProps;
};

export default function MapView({
  ref,
  filterJson,
  flyToTarget,
  zoomCommand,
  baseLayer = "satellite",
  colorScheme = "dark",
  bgColor = "rgb(22, 22, 22)",
  initialLat,
  initialLng,
  initialZoom,
  coverageVisible = false,
  shapesVisible = true,
  detectionsVisible = false,
  trackHistoryVisible = false,
  clusteringEnabled = true,
  isPlacing = false,
  placementCoordColors,
  onReady,
  onEntityClick,
  onMapClick,
  onPathCommit,
  onPathInsert,
  onDoubleClickFinish,
  onSavedPathsArrived,
  onRadialRequest,
  onTrackingLost,
  onViewChange,
  onPointerTypeChange,
}: MapViewProps) {
  const initialView =
    initialLat != null && initialLng != null && initialZoom != null
      ? { lat: initialLat, lng: initialLng, zoom: initialZoom }
      : undefined;
  const mapActionsRef = useRef<MapActions | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const lastFlyToCommandIdRef = useRef(-1);
  const lastZoomCommandRef = useRef<string | null>(null);
  const pendingFlyToRef = useRef<{
    lat: number;
    lng: number;
    alt?: number;
    duration?: number;
    zoom?: number;
  } | null>(null);

  const entityMapRef = useRef(new Map<string, EntityData>());

  useEffect(() => {
    return () => {
      if (renderTimerRef.current !== null) clearTimeout(renderTimerRef.current);
    };
  }, []);

  const [entityVersion, setEntityVersion] = useState(0);
  const [geoChanged, setGeoChanged] = useState(true);
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());
  const [pushedSelectedId, setPushedSelectedId] = useState<string | null>(null);
  const [pushedTrackedId, setPushedTrackedId] = useState<string | null>(null);
  const [pushedBaseLayer, setPushedBaseLayer] = useState<string>(baseLayer);
  const [pushedFilterJson, setPushedFilterJson] = useState<string>(filterJson ?? "");
  const [pushedCoverageVisible, setPushedCoverageVisible] = useState(coverageVisible);
  const [pushedShapesVisible, setPushedShapesVisible] = useState(shapesVisible);
  const [pushedDetectionsVisible, setPushedDetectionsVisible] = useState(detectionsVisible);
  const [pushedTrackHistoryVisible, setPushedTrackHistoryVisible] = useState(trackHistoryVisible);
  const [pushedClusteringEnabled, setPushedClusteringEnabled] = useState(clusteringEnabled);
  const [pushedBullseyeCenter, setPushedBullseyeCenter] = useState<GeoPosition | null>(null);
  const [pushedPaths, setPushedPaths] = useState<MapPath[]>([]);
  const [pushedDrawingId, setPushedDrawingId] = useState<string | null>(null);
  const [pushedEditablePathId, setPushedEditablePathId] = useState<string | null>(null);
  const editablePathIdRef = useRef<string | null>(null);
  const [pathDragOverride, setPathDragOverride] = useState<{
    pathId: string;
    sourceIndex: number;
    point: PathPoint;
  } | null>(null);
  const [pushedActiveTool, setPushedActiveTool] = useState<ActiveTool>("none");
  const [pushedHiddenLayerIds, setPushedHiddenLayerIds] = useState<Set<string>>(new Set());
  const [pushedLayerOpacity, setPushedLayerOpacity] = useState<Record<string, number>>({});

  const awaitedIdsRef = useRef(new Set<string>());
  const pendingLocalRef = useRef(false);
  const pendingGeoRef = useRef(false);
  const pendingIdsRef = useRef(new Set<string>());
  const pendingVersionRef = useRef(0);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deltaQueueRef = useRef<SerializedDelta[]>([]);
  const processingRef = useRef(false);

  const CHUNK_SIZE = 2000;

  const filter: EntityFilter | undefined = pushedFilterJson
    ? JSON.parse(pushedFilterJson)
    : undefined;
  const resolvedFilter = filter ?? {
    tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
    sensors: {},
  };

  const flushRender = () => {
    if (renderTimerRef.current !== null) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = null;
    const ids = pendingIdsRef.current;
    const geo = pendingGeoRef.current;
    const ver = pendingVersionRef.current;
    pendingIdsRef.current = new Set();
    pendingGeoRef.current = false;
    setUpdatedIds(ids);
    setGeoChanged(geo);
    setEntityVersion(ver);
  };

  const scheduleRender = () => {
    if (pendingLocalRef.current) {
      pendingLocalRef.current = false;
      flushRender();
      return;
    }
    for (const id of awaitedIdsRef.current) {
      if (pendingIdsRef.current.has(id)) {
        flushRender();
        return;
      }
    }
    if (renderTimerRef.current !== null) return;
    renderTimerRef.current = setTimeout(flushRender, 300);
  };

  const processEntities = (
    map: Map<string, EntityData>,
    entities: SerializedEntityData[],
    start: number,
    end: number,
  ) => {
    for (let i = start; i < end; i++) {
      const e = entities[i]!;
      if (!pendingGeoRef.current && e.position && !map.has(e.id)) {
        pendingGeoRef.current = true;
      }
      map.set(e.id, deserializeEntity(e));
      pendingIdsRef.current.add(e.id);
    }
  };

  const processQueue = () => {
    const delta = deltaQueueRef.current[0];
    if (!delta) {
      processingRef.current = false;
      return;
    }

    const map = entityMapRef.current;

    if (delta.fullRebuild) {
      map.clear();
    } else {
      for (const id of delta.removed) {
        map.delete(id);
      }
    }
    if (delta.geoChanged) pendingGeoRef.current = true;
    if (delta.local) pendingLocalRef.current = true;
    pendingVersionRef.current = delta.version;

    const entities = delta.entities;

    if (entities.length <= CHUNK_SIZE) {
      processEntities(map, entities, 0, entities.length);
      deltaQueueRef.current.shift();
      scheduleRender();
      processQueue();
      return;
    }

    let offset = 0;
    const processChunk = () => {
      const end = Math.min(offset + CHUNK_SIZE, entities.length);
      processEntities(map, entities, offset, end);
      offset = end;
      scheduleRender();

      if (offset < entities.length) {
        setTimeout(processChunk, 0);
      } else {
        deltaQueueRef.current.shift();
        processQueue();
      }
    };
    processChunk();
  };

  const enqueueDelta = (delta: SerializedDelta) => {
    deltaQueueRef.current.push(delta);
    if (!processingRef.current) {
      processingRef.current = true;
      processQueue();
    }
  };

  useEffect(() => {
    awaitedIdsRef.current = new Set(
      pushedPaths.flatMap((path) => (path.savedAs ? [path.savedAs] : [])),
    );
  }, [pushedPaths]);

  useEffect(() => {
    const arrived = arrivedPathIds(pushedPaths, (id) => entityMapRef.current.has(id));
    if (arrived.length > 0) void onSavedPathsArrived?.(JSON.stringify(arrived));
  }, [entityVersion, pushedPaths, onSavedPathsArrived]);

  const lastChange = { version: entityVersion, geoChanged, updatedIds };
  const dragOverrideLanded = hasDragLanded(entityMapRef.current, pathDragOverride);
  const renderedPaths = collectRenderedPaths({
    entities: entityMapRef.current,
    local: pushedPaths,
    editingId: pushedEditablePathId,
    dragOverride: pathDragOverride,
  });

  const pathAnchorPositions = new Map<string, GeoPosition>();
  const pathAnchorVerticalRates = new Map<string, number>();
  for (const path of renderedPaths) {
    for (const point of path.points) {
      if (point.type !== "entity") continue;
      const entity = entityMapRef.current.get(point.entityId);
      if (entity?.position) pathAnchorPositions.set(point.entityId, entity.position);
      const verticalRate = calculateVerticalRate(entity?.velocityEnu);
      if (verticalRate !== undefined) pathAnchorVerticalRates.set(point.entityId, verticalRate);
    }
  }

  const pathData = {
    paths: renderedPaths.map((path) =>
      buildPathLayerData(path, pathAnchorPositions, pathAnchorVerticalRates),
    ),
    drawingId: pushedDrawingId,
  };

  useDOMImperativeHandle(
    ref as Ref<DOMImperativeFactory>,
    () =>
      ({
        zoomIn: () => mapActionsRef.current?.zoomIn(),
        zoomOut: () => mapActionsRef.current?.zoomOut(),
        flyTo: (lat: number, lng: number, _alt?: number, duration?: number, zoom?: number) => {
          if (mapActionsRef.current) {
            mapActionsRef.current.flyTo({ lat, lng }, { duration: duration ?? 1.5, zoom });
          } else {
            pendingFlyToRef.current = { lat, lng, alt: _alt, duration, zoom };
          }
        },
        pushDelta: (deltaJson: string) => {
          const delta: SerializedDelta = JSON.parse(deltaJson);
          enqueueDelta(delta);
        },
        pushSelection: (selectedId: string | null, trackedId: string | null) => {
          setPushedSelectedId(selectedId);
          setPushedTrackedId(trackedId);
        },
        pushSettings: (
          baseLayer: string,
          filterJson: string,
          coverageVisible: boolean,
          shapesVisible: boolean,
          detectionsVisible: boolean,
          trackHistoryVisible: boolean,
          clusteringEnabled: boolean,
        ) => {
          setPushedBaseLayer(baseLayer);
          setPushedFilterJson(filterJson);
          setPushedCoverageVisible(coverageVisible);
          setPushedShapesVisible(shapesVisible);
          setPushedDetectionsVisible(detectionsVisible);
          setPushedTrackHistoryVisible(trackHistoryVisible);
          setPushedClusteringEnabled(clusteringEnabled);
        },
        pushBullseye: (centerJson: string | null) => {
          setPushedBullseyeCenter(centerJson ? JSON.parse(centerJson) : null);
        },
        pushPaths: (
          pathsJson: string,
          drawingId: string | null,
          activeTool: ActiveTool,
          editablePathId: string | null,
        ) => {
          const paths: MapPath[] = JSON.parse(pathsJson);
          const previousEditingId = editablePathIdRef.current;
          editablePathIdRef.current = editablePathId;
          setPushedPaths(paths);
          setPushedDrawingId(drawingId);
          setPushedActiveTool(activeTool);
          setPushedEditablePathId(editablePathId);
          setPathDragOverride((override) =>
            reconcileEditDragOverride(paths, editablePathId, override, previousEditingId),
          );
        },
        pushHiddenLayers: (idsJson: string) => {
          const ids: string[] = JSON.parse(idsJson);
          setPushedHiddenLayerIds(new Set(ids));
        },
        pushLayerOpacity: (json: string) => {
          setPushedLayerOpacity(JSON.parse(json));
        },
      }) as DOMImperativeFactory,
    [],
  );

  useEffect(() => {
    if (!flyToTarget || !actionsReady || !mapActionsRef.current) return;
    if (flyToTarget.commandId === lastFlyToCommandIdRef.current) return;

    lastFlyToCommandIdRef.current = flyToTarget.commandId;
    mapActionsRef.current.flyTo(
      { lat: flyToTarget.lat, lng: flyToTarget.lng },
      { duration: flyToTarget.duration ?? 1.5, zoom: flyToTarget.zoom },
    );
  }, [flyToTarget, actionsReady]);

  useEffect(() => {
    if (!zoomCommand || !actionsReady || !mapActionsRef.current) return;
    if (zoomCommand === lastZoomCommandRef.current) return;

    lastZoomCommandRef.current = zoomCommand;

    const [direction] = zoomCommand.split("-");
    if (direction === "in") {
      mapActionsRef.current.zoomIn();
    } else {
      mapActionsRef.current.zoomOut();
    }
  }, [zoomCommand, actionsReady]);

  const handleActionsReady = (actions: MapActions) => {
    mapActionsRef.current = actions;
    setActionsReady(true);

    if (pendingFlyToRef.current) {
      const { lat, lng, duration, zoom } = pendingFlyToRef.current;
      actions.flyTo({ lat, lng }, { duration: duration ?? 1.5, zoom });
      pendingFlyToRef.current = null;
    }
  };

  useEffect(() => {
    if (dragOverrideLanded) setPathDragOverride(null);
  }, [dragOverrideLanded]);

  const handlePathDrag = (
    pathId: string,
    sourceIndex: number,
    point: PathPoint,
    phase: "move" | "release",
  ) => {
    setPathDragOverride({ pathId, sourceIndex, point });
    if (phase === "move") return;

    setPushedPaths((paths) =>
      paths.map((path) =>
        path.id === pathId
          ? movePathVertex(
              path,
              sourceIndex,
              point,
              livePositions(entityMapRef.current, [...path.points, point]),
            )
          : path,
      ),
    );
    if (!entityMapRef.current.has(pathId)) setPathDragOverride(null);
    return onPathCommit?.(pathId, sourceIndex, JSON.stringify(point))?.catch(() => {
      setPathDragOverride(null);
    });
  };

  const baseStyles = `
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background-color: ${bgColor};
    }
  `;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bgColor,
        position: "relative",
        zIndex: 0,
      }}
    >
      <style>{baseStyles}</style>
      <MapAdapter
        entityMap={entityMapRef.current}
        lastChange={lastChange}
        filter={resolvedFilter}
        selectedId={pushedSelectedId}
        trackedId={pushedTrackedId}
        baseLayer={pushedBaseLayer}
        colorScheme={colorScheme}
        initialView={initialView}
        coverageVisible={pushedCoverageVisible}
        shapesVisible={pushedShapesVisible}
        detectionsVisible={pushedDetectionsVisible}
        trackHistoryVisible={pushedTrackHistoryVisible}
        clusteringEnabled={pushedClusteringEnabled}
        isPlacing={isPlacing}
        placementCoordColors={placementCoordColors}
        bullseyeCenter={pushedBullseyeCenter}
        pathData={pathData}
        activeTool={pushedActiveTool}
        editablePathId={pushedEditablePathId}
        getRangePreviewLabel={getRangePreviewLabel}
        hiddenMapLayerIds={pushedHiddenLayerIds}
        mapLayerOpacityOverrides={pushedLayerOpacity}
        onEntityClick={async (id) => await onEntityClick?.(id)}
        onMapClick={async (point) => await onMapClick?.(JSON.stringify(point))}
        onPathDrag={handlePathDrag}
        onPathInsert={async (pathId, sourceIndex, point) =>
          await onPathInsert?.(pathId, sourceIndex, JSON.stringify(point))
        }
        onDoubleClickFinish={() => void onDoubleClickFinish?.()}
        onRadialRequest={async (entityId, screenX, screenY, lat, lng) =>
          await onRadialRequest?.(entityId, screenX, screenY, lat, lng)
        }
        onReady={async () => await onReady?.()}
        onTrackingLost={async () => await onTrackingLost?.()}
        onViewChange={async (lat, lng, zoom) => await onViewChange?.(lat, lng, zoom)}
        onPointerTypeChange={async (pointerType) => await onPointerTypeChange?.(pointerType)}
        onActionsReady={handleActionsReady}
      />
    </div>
  );
}
