import "maplibre-gl/dist/maplibre-gl.css";
import "./overrides.css";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { FeatureCollection } from "geojson";
import type { ImageSource, MapMouseEvent, MapTouchEvent, StyleSpecification } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapRef, ViewStateChangeEvent } from "react-map-gl/maplibre";
import { Map as MapGL, ScaleControl, useControl } from "react-map-gl/maplibre";

import { BASE_LAYER_SOURCES, DEFAULT_POSITION } from "../../constants";
import { drawingPreviewFeatures } from "../../geometry/drawing-preview";
import { useShapeWorker } from "../../geometry/use-shape-worker";
import {
  createBullseyeLayers,
  createCoverageLayer,
  createLabelLayer,
  createSelectionLayer,
  createSensorSectorLayer,
  createShapeLayer,
  prepareSectorData,
  type SectorRenderData,
  useEntityClusters,
} from "../../layers";
import {
  composePathLayers,
  createPathLayers,
  createRangeInteractionLayers,
  PATH_FILL_LAYER_ID,
  PATH_LINE_CASING_LAYER_ID,
  PATH_SEGMENT_LABEL_LAYER_ID,
  PATH_TOTAL_LABEL_LAYER_ID,
  PATH_VERTEX_LAYER_ID,
  pathFillColor,
  type PathLayerData,
  pathLineColor,
  type RangePreview,
} from "../../layers/path-layer";
import {
  downgradeHiddenPathAnchors,
  findDrawnPathVertex,
  isPathLegible,
  type PathVertex,
} from "../../layers/path-logic";
import type {
  BaseLayer,
  EntityData,
  EntityFilter,
  GeoPosition,
  MapLayer,
  PathPoint,
  ShapeFeature,
  ShapeProperties,
} from "../../types";
import { type GeodesicViewport, wrapLongitude } from "../../utils/geodesic-path";
import { shapeToFeatures } from "../../utils/shape-to-geojson";
import { isShapeVisible, type ShapeVisibilityContext } from "../../utils/shape-visibility";
// source: https://github.com/openmaptiles/positron-gl-style/blob/master/style.json
import openmaptilesStyle from "./assets/openmaptiles-style.json";
import { CenterReticle } from "./center-reticle";
import { setupMapGestureDrag } from "./map-gesture-drag";
import {
  type ActiveTool,
  closingVertexOf,
  findPickedEntityId,
  findPickedPathId,
  findPickedPathVertexTarget,
  findPickedShapeId,
  findPlacingPath,
  isSlippedClick,
  isVertexUnlocked,
  PATH_VERTEX_PICK_RADIUS,
  pathAnchors,
  type PathVertexTarget,
  resolveClaimedVertexTap,
  resolveEntityLayerClick,
  resolveMapClick,
  resolveMapCursor,
  resolveRangeMapCommit,
  shouldFinishOnDoubleClick,
  vertexPickRadius,
} from "./path-map-interaction";

export type { ActiveTool };

const SECTOR_MIN_ZOOM = 12;
const OVERLAP_ZOOM_TOLERANCE = 2;

const API_BASE = process.env.EXPO_PUBLIC_HYDRIS_API_URL ?? "";

// Copied from maplibre's ScaleControl so ring gaps match the scale bar exactly
function getDecimalRoundNum(d: number): number {
  const multiplier = Math.pow(10, Math.ceil(-Math.log(d) / Math.LN10));
  return Math.round(d * multiplier) / multiplier;
}

function getRoundNum(num: number): number {
  const pow10 = Math.pow(10, `${Math.floor(num)}`.length - 1);
  let d = num / pow10;
  d = d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : d >= 1 ? 1 : getDecimalRoundNum(d);
  return pow10 * d;
}

// Read before any pointer event reaches the map, so it cannot wait for one.
function detectPointerType(): string | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(pointer: coarse)").matches ? "touch" : null;
}

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  samplingViewport?: GeodesicViewport;
};

const INITIAL_VIEW_STATE: ViewState = {
  longitude: DEFAULT_POSITION.lng,
  latitude: DEFAULT_POSITION.lat,
  zoom: DEFAULT_POSITION.zoom,
};

type DeckGLOverlayProps = {
  layers: Layer[];
  pickingRadius?: number;
  onClick?: (info: PickingInfo) => void;
  onHover?: (info: PickingInfo) => void;
  onOverlayReady?: (overlay: MapboxOverlay) => void;
};

function DeckGLOverlay({
  layers,
  pickingRadius,
  onClick,
  onHover,
  onOverlayReady,
}: DeckGLOverlayProps) {
  const overlay = useControl(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius,
        onClick,
        onHover,
        useDevicePixels: 2,
        // luma.gl auto-enables WebGL debug mode when NODE_ENV !== "production",
        // which wraps every GL call and tanks pan/zoom perf. Force it off.
        deviceProps: { debug: false },
      }),
  );
  useEffect(() => {
    onOverlayReady?.(overlay);
  }, [overlay, onOverlayReady]);
  try {
    overlay.setProps({
      layers,
      pickingRadius,
      onClick,
      onHover,
    });
  } catch {
    // map state is mid-rebuild after gl context loss; next render picks up
  }
  return null;
}

const createRasterStyle = (
  tiles: string[],
  attribution: string,
  maxZoom = 20,
): StyleSpecification => ({
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    raster: {
      type: "raster",
      tiles,
      tileSize: 256,
      maxzoom: maxZoom,
      attribution,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#000000" } },
    { id: "raster-layer", type: "raster", source: "raster", paint: {} },
  ],
});

// mbtiles as full style so maplibre swaps at once.
function buildOfflineStyle(layer: MapLayer): StyleSpecification {
  const path = `${API_BASE}${layer.url}`;
  const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
  const glyphsBase = API_BASE.startsWith("http")
    ? API_BASE
    : `${window.location.origin}${API_BASE}`;
  if (layer.url.endsWith(".pbf")) {
    const base = openmaptilesStyle as unknown as StyleSpecification;
    return {
      ...base,
      glyphs: `${glyphsBase}/glyphs/{fontstack}/{range}.pbf`,
      sources: { openmaptiles: { type: "vector", tiles: [url] } },
      layers: base.layers.map((l) =>
        l.type === "symbol"
          ? { ...l, layout: { ...l.layout, "text-font": ["Noto Sans Regular"] } }
          : l,
      ),
    };
  }
  return createRasterStyle([url], "", 22);
}

// dark and street are hosted vector styles; satellite stays a raster style.
const STYLES: Record<BaseLayer, StyleSpecification | string> = {
  dark: BASE_LAYER_SOURCES.dark.url,
  satellite: createRasterStyle(
    [BASE_LAYER_SOURCES.satellite.url],
    BASE_LAYER_SOURCES.satellite.attribution,
    BASE_LAYER_SOURCES.satellite.maxZoom,
  ),
  street: BASE_LAYER_SOURCES.street.url,
};

const isBaseLayer = (s: string): s is BaseLayer => Object.hasOwn(STYLES, s);

const DEFAULT_FILTER: EntityFilter = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: {},
};

type PlacementCoordColors = { bg: string; border: string; text: string };

export type MapActions = {
  flyTo: (position: GeoPosition, options?: { zoom?: number; duration?: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getView: () => { lat: number; lng: number; zoom: number } | null;
};

type ChangeInfo = {
  version: number;
  geoChanged: boolean;
  updatedIds?: Set<string>;
};

export type MapClickPoint = PathPoint;

export type MapViewProps = {
  entityMap?: Map<string, EntityData>;
  lastChange?: ChangeInfo;
  filter?: EntityFilter;
  selectedId?: string | null;
  trackedId?: string | null;
  baseLayer?: string;
  colorScheme?: "dark" | "light";
  initialView?: { lat: number; lng: number; zoom: number };
  coverageVisible?: boolean;
  shapesVisible?: boolean;
  detectionsVisible?: boolean;
  trackHistoryVisible?: boolean;
  clusteringEnabled?: boolean;
  bullseyeCenter?: GeoPosition | null;
  pathData?: PathLayerData | null;
  activeTool?: ActiveTool;
  editablePathId?: string | null;
  hiddenMapLayerIds?: ReadonlySet<string>;
  mapLayerOpacityOverrides?: Readonly<Record<string, number>>;
  isPlacing?: boolean;
  placementCoordColors?: PlacementCoordColors;
  getRangePreviewLabel?: (source: GeoPosition, target: GeoPosition) => string;
  onEntityClick?: (id: string | null) => void | Promise<void>;
  onMapClick?: (point: MapClickPoint) => void | Promise<void>;
  onPathDrag?: (
    pathId: string,
    sourceIndex: number,
    point: MapClickPoint,
    phase: "move" | "release",
  ) => void | Promise<void>;
  onPathInsert?: (
    pathId: string,
    sourceIndex: number,
    point: MapClickPoint,
  ) => void | Promise<void>;
  onDoubleClickFinish?: () => void;
  onRadialRequest?: (
    entityId: string | null,
    screenX: number,
    screenY: number,
    lat: number,
    lng: number,
  ) => void | Promise<void>;
  onReady?: () => void | Promise<void>;
  onActionsReady?: (actions: MapActions) => void;
  onTrackingLost?: () => void | Promise<void>;
  onViewChange?: (lat: number, lng: number, zoom: number) => void | Promise<void>;
  onPointerTypeChange?: (pointerType: string) => void | Promise<void>;
};

const EMPTY_MAP: Map<string, EntityData> = new Map();

export function MapView({
  entityMap = EMPTY_MAP,
  lastChange,
  filter = DEFAULT_FILTER,
  selectedId = null,
  trackedId = null,
  baseLayer = "satellite",
  colorScheme = "dark",
  initialView,
  coverageVisible = false,
  shapesVisible = true,
  detectionsVisible = false,
  trackHistoryVisible = false,
  clusteringEnabled = true,
  bullseyeCenter = null,
  pathData = null,
  activeTool = "none",
  editablePathId = null,
  hiddenMapLayerIds,
  mapLayerOpacityOverrides,
  isPlacing = false,
  placementCoordColors,
  getRangePreviewLabel,
  onEntityClick,
  onMapClick,
  onPathDrag,
  onPathInsert,
  onDoubleClickFinish,
  onRadialRequest,
  onReady,
  onActionsReady,
  onTrackingLost,
  onViewChange,
  onPointerTypeChange,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const samplingViewportRef = useRef<{ zoom: number; viewport: GeodesicViewport } | null>(null);

  const getSamplingViewport = (): GeodesicViewport | undefined => {
    const map = mapRef.current;
    if (!map) return undefined;
    const bounds = map.getBounds();
    const zoom = Math.ceil(map.getZoom());
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const width = east - west;
    const height = north - south;
    const cached = samplingViewportRef.current;
    if (
      cached?.zoom === zoom &&
      west - width / 2 >= cached.viewport.west &&
      east + width / 2 <= cached.viewport.east &&
      south - height / 2 >= cached.viewport.south &&
      north + height / 2 <= cached.viewport.north
    )
      return cached.viewport;
    // Refine ahead of a pan, while the old geometry still covers the visible viewport.
    const viewport = {
      west: west - 2 * width,
      east: east + 2 * width,
      south: south - 2 * height,
      north: north + 2 * height,
    };
    samplingViewportRef.current = { zoom, viewport };
    return viewport;
  };
  const onlineBaseLayer: BaseLayer | null = isBaseLayer(baseLayer) ? baseLayer : null;
  const resolvedInitialView = initialView
    ? { longitude: initialView.lng, latitude: initialView.lat, zoom: initialView.zoom }
    : INITIAL_VIEW_STATE;
  const [viewState, setViewState] = useState<ViewState>(resolvedInitialView);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [pointerType, setPointerType] = useState<string | null>(detectPointerType);
  const pointerTypeRef = useRef<string | null>(pointerType);
  const viewStateRef = useRef(viewState);

  // Everything deck.gl and maplibre call back into reads through a ref, because
  // the handlers are installed once and would otherwise hold the props of that
  // render forever.
  const onEntityClickRef = useRef(onEntityClick);
  const onMapClickRef = useRef(onMapClick);
  const onPathDragRef = useRef(onPathDrag);
  const onPathInsertRef = useRef(onPathInsert);
  const pathDataRef = useRef(pathData);
  const activeToolRef = useRef(activeTool);
  const onRadialRequestRef = useRef(onRadialRequest);
  const onDoubleClickFinishRef = useRef(onDoubleClickFinish);
  const getRangePreviewLabelRef = useRef(getRangePreviewLabel);
  const pathBaseLayerRef = useRef<BaseLayer>(onlineBaseLayer ?? "dark");
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const baseLayersRef = useRef<Layer[]>([]);
  const pathInteractionLayersRef = useRef<Layer[]>([]);
  const pathPreviewRef = useRef<{
    preview: RangePreview;
    closingVertex: PathVertex | null;
  } | null>(null);
  const pulseFrameRef = useRef<number | null>(null);
  const pulseStartedAtRef = useRef(0);
  const pathAimPointRef = useRef<{ x: number; y: number } | null>(null);
  const refreshRangeAimRef = useRef<() => void>(() => {});
  const suppressRangeTapRef = useRef(false);
  const actionsReadyCalledRef = useRef(false);
  const shapesCollectionRef = useRef<FeatureCollection<ShapeFeature["geometry"], ShapeProperties>>({
    type: "FeatureCollection",
    features: [],
  });
  const shapeEntityIdsRef = useRef(new Set<string>());
  const lastShapeVersionRef = useRef(-1);
  const lastTrackedPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLayerClickTimeRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const pressRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const [overlapOffsets, setOverlapOffsets] = useState<Map<string, [number, number]> | null>(null);
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string> | null>(null);
  const overlapActivationZoomRef = useRef<number | null>(null);
  const assemblyMinZoomRef = useRef<number | null>(null);
  const sizeObserverRef = useRef<ResizeObserver | null>(null);
  const sizeReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    document.fonts.load("16px Inter").then(() => setFontLoaded(true));
  }, []);

  useEffect(() => {
    if (pointerTypeRef.current) void onPointerTypeChange?.(pointerTypeRef.current);
  }, []);

  useEffect(() => {
    return () => {
      sizeObserverRef.current?.disconnect();
      pathDragCleanupRef.current?.();
      stopClosingPulse();
      if (sizeReconcileTimerRef.current) clearTimeout(sizeReconcileTimerRef.current);
    };
  }, []);

  // Synced after commit rather than during render: a ref written mid-render is
  // a mutation React is free to throw away, and these are read from handlers
  // that can fire before a passive effect would have run.
  useLayoutEffect(() => {
    viewStateRef.current = viewState;
    onEntityClickRef.current = onEntityClick;
    onMapClickRef.current = onMapClick;
    onPathDragRef.current = onPathDrag;
    onPathInsertRef.current = onPathInsert;
    pathDataRef.current = pathData;
    activeToolRef.current = activeTool;
    onRadialRequestRef.current = onRadialRequest;
    onDoubleClickFinishRef.current = onDoubleClickFinish;
    editablePathIdRef.current = editablePathId;
    getRangePreviewLabelRef.current = getRangePreviewLabel;
    pathBaseLayerRef.current = onlineBaseLayer ?? "dark";
  });

  // Update debounce timer when selection changes from outside (e.g., left panel)
  useEffect(() => {
    if (selectedId) {
      lastLayerClickTimeRef.current = Date.now();
    }
  }, [selectedId]);

  // Enter on selected entity opens radial at entity's position.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      // Enter finishes whatever is being placed or edited, handled in the app
      if (activeTool !== "none" || editablePathId) return;
      if (!selectedId) return;
      const entity = entityMap.get(selectedId);
      if (!entity?.position) return;
      const map = mapRef.current?.getMap();
      if (!map) return;
      const p = map.project([entity.position.lng, entity.position.lat]);
      onRadialRequestRef.current?.(selectedId, p.x, p.y, entity.position.lat, entity.position.lng);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedId, entityMap, activeTool, editablePathId]);

  const setCursor = (cursor: string) => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas && canvas.style.cursor !== cursor) {
      canvas.style.cursor = cursor;
    }
  };

  const pickEntityId = (x: number, y: number) => {
    const infos = overlayRef.current?.pickObjects({ x: x - 8, y: y - 8, width: 16, height: 16 });
    return findPickedEntityId((infos ?? []).map((info) => info.object));
  };

  const pickPathEntityId = (x: number, y: number) => {
    if (activeToolRef.current === "range") return null;
    const info = overlayRef.current?.pickObject({
      x,
      y,
      radius: PATH_VERTEX_PICK_RADIUS,
      layerIds: [PATH_LINE_CASING_LAYER_ID, PATH_SEGMENT_LABEL_LAYER_ID, PATH_TOTAL_LABEL_LAYER_ID],
    });
    const pathId = findPickedPathId(info?.object);
    return pathId && entityMap.has(pathId) ? pathId : null;
  };

  const editablePathIdRef = useRef(editablePathId);

  const pickPathVertexTarget = (x: number, y: number) => {
    const info = overlayRef.current?.pickObject({
      x,
      y,
      radius: PATH_VERTEX_PICK_RADIUS,
      layerIds: [PATH_VERTEX_LAYER_ID],
    });
    const target = findPickedPathVertexTarget(info?.object);
    return isVertexUnlocked(
      target,
      editablePathIdRef.current,
      pathDataRef.current?.drawingId ?? null,
    )
      ? target
      : null;
  };

  const pickShapeEntityId = (x: number, y: number) => {
    const info = overlayRef.current?.pickObject({
      x,
      y,
      radius: 8,
      layerIds: ["shapes", PATH_FILL_LAYER_ID],
    });
    const id = findPickedShapeId(info?.object);
    return id && entityMap.has(id) ? id : null;
  };

  const pickEditableFreeformSegment = (x: number, y: number) => {
    const editableId = editablePathIdRef.current;
    const editable = pathDataRef.current?.paths.find((path) => path.id === editableId);
    if (!editableId || editable?.kind !== "freeform") return null;
    const info = overlayRef.current?.pickObject({
      x,
      y,
      radius: 8,
      layerIds: [PATH_LINE_CASING_LAYER_ID],
    });
    const target = findPickedPathVertexTarget(info?.object);
    return target?.pathId === editableId ? target : null;
  };

  // Open radial for whatever is under the pointer.
  // Right click on web, long press on touch (manual for Android).
  const setupRadialTriggers = (map: ReturnType<NonNullable<typeof mapRef.current>["getMap"]>) => {
    const fire = (e: MapMouseEvent | MapTouchEvent) => {
      const id =
        pickEntityId(e.point.x, e.point.y) ??
        pickPathEntityId(e.point.x, e.point.y) ??
        pickShapeEntityId(e.point.x, e.point.y);
      onRadialRequestRef.current?.(id, e.point.x, e.point.y, e.lngLat.lat, e.lngLat.lng);
    };

    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelHold = () => clearTimeout(holdTimer);

    map.on("contextmenu", (e) => {
      e.preventDefault();
      // the same right-click otherwise bubbles to the radial's dismiss listener
      // and closes the menu it just opened. only surfaces on Windows, which
      // fires contextmenu on mouse-up after that listener is already live.
      e.originalEvent.stopPropagation();
      fire(e);
    });
    map.on("touchstart", (e) => {
      cancelHold();
      suppressRangeTapRef.current = false;
      holdTimer = setTimeout(() => {
        suppressRangeTapRef.current = true;
        const segment = pickEditableFreeformSegment(e.point.x, e.point.y);
        const insert = onPathInsertRef.current;
        if (segment && insert) {
          void insert(segment.pathId, segment.sourceIndex, {
            type: "coordinate",
            position: { lat: e.lngLat.lat, lng: wrapLongitude(e.lngLat.lng) },
          });
          return;
        }
        fire(e);
      }, 450);
    });
    map.on("touchmove", cancelHold);
    map.on("touchend", cancelHold);

    // A tool with no point count of its own, and an open edit, both need a way
    // to say "done" without reaching for the bar. Anything else keeps the
    // double-click zoom.
    map.on("dblclick", (e) => {
      if (
        !shouldFinishOnDoubleClick(
          pointerTypeRef.current,
          placingPath()?.endsByGesture === true,
          editablePathIdRef.current !== null,
        )
      )
        return;
      e.preventDefault();
      onDoubleClickFinishRef.current?.();
    });
  };

  const commitRangeEntity = (entityId: string) => {
    const drawingPath = pathDataRef.current?.paths.find(
      (path) => path.id === pathDataRef.current?.drawingId,
    );
    const lastPosition = drawingPath?.vertices.at(-1)?.position;
    const entityPosition = entityMap.get(entityId)?.position;
    if (
      lastPosition &&
      entityPosition &&
      lastPosition.lat === entityPosition.lat &&
      lastPosition.lng === entityPosition.lng
    ) {
      return;
    }
    clearRangeAim();
    void onMapClickRef.current?.({ type: "entity", entityId });
  };

  const resolveRangeAtScreenPoint = (
    point: { x: number; y: number },
    coordinate?: GeoPosition,
    pickedPathVertex?: PathVertexTarget | null,
  ) => {
    const map = mapRef.current;
    const data = pathDataRef.current;
    return resolveRangeMapCommit({
      point,
      pickedPathVertex:
        pickedPathVertex === undefined ? pickPathVertexTarget(point.x, point.y) : pickedPathVertex,
      drawnPathVertex: findDrawnPathVertex(data, map, point, data?.drawingId) ?? null,
      pickEntityId,
      coordinateForPoint: () => {
        const position = coordinate ?? map?.unproject([point.x, point.y]);
        return position ? { lat: position.lat, lng: wrapLongitude(position.lng) } : undefined;
      },
    });
  };

  const drawingPreviewRef = useRef<Layer[]>([]);
  const lastHoverPointRef = useRef<{ x: number; y: number } | null>(null);

  // vertex dots stay above preview lines, so a preview never draws through the
  // point it is anchored to
  const overlayLayers = (base: readonly Layer[]) =>
    composePathLayers(base, [...drawingPreviewRef.current, ...pathInteractionLayersRef.current]);

  const applyOverlayLayers = () => {
    overlayRef.current?.setProps({ layers: overlayLayers(baseLayersRef.current) });
  };

  // tapping a closable path's own first vertex lands exactly on it, which is how
  // a freeform closes into an area
  const drawingTapPosition = (
    point: { x: number; y: number },
    coordinate: GeoPosition,
  ): GeoPosition => closingVertexAt(point)?.position ?? coordinate;

  const placingPath = () => findPlacingPath(pathDataRef.current);

  const closingVertexAt = (point: { x: number; y: number }): PathVertex | null => {
    // Only closing gets a finger-sized pick radius; ordinary vertex picks stay narrow.
    const info = overlayRef.current?.pickObject({
      x: point.x,
      y: point.y,
      radius: vertexPickRadius(pointerTypeRef.current === "touch"),
      layerIds: [PATH_VERTEX_LAYER_ID],
    });
    return closingVertexOf(placingPath(), findPickedPathVertexTarget(info?.object));
  };

  const updateDrawingPreview = (point: { x: number; y: number } | null) => {
    const hovered = point ? mapRef.current?.getMap().unproject([point.x, point.y]) : undefined;
    const features = drawingPreviewFeatures({
      data: pathDataRef.current,
      aim: hovered ? { lat: hovered.lat, lng: wrapLongitude(hovered.lng) } : undefined,
      zoom: mapRef.current?.getZoom() ?? viewStateRef.current.zoom,
      viewport: getSamplingViewport(),
    });
    if (features.length === 0 && drawingPreviewRef.current.length === 0) return;

    drawingPreviewRef.current = features.length
      ? createShapeLayer({
          id: "drawing-preview",
          data: features,
          visible: true,
          selectedId: null,
          pickable: false,
          filled: false,
          baseLayer: pathBaseLayerRef.current,
          drawnColor: pathLineColor(pathBaseLayerRef.current),
        })
      : [];
    applyOverlayLayers();
  };

  // Pointer and pan updates stay imperative so aiming never re-renders the map adapter.
  const applyRangeInteractionLayers = (interactionLayers: Layer[]) => {
    pathInteractionLayersRef.current = interactionLayers;
    applyOverlayLayers();
  };

  const renderRangePreview = (pulsePhase = 0) => {
    const current = pathPreviewRef.current;
    applyRangeInteractionLayers(
      current
        ? createRangeInteractionLayers({
            ...current,
            zoom: mapRef.current?.getZoom() ?? viewStateRef.current.zoom,
            viewport: getSamplingViewport(),
            pulsePhase,
            baseLayer: pathBaseLayerRef.current,
          })
        : [],
    );
  };

  const stopClosingPulse = () => {
    if (pulseFrameRef.current === null) return;
    cancelAnimationFrame(pulseFrameRef.current);
    pulseFrameRef.current = null;
  };

  const runClosingPulse = (now: number) => {
    pulseFrameRef.current = null;
    if (!pathAimPointRef.current || !pathPreviewRef.current?.closingVertex) return;
    const elapsed = now - pulseStartedAtRef.current;
    renderRangePreview((1 - Math.cos((elapsed / 1400) * Math.PI * 2)) / 2);
    pulseFrameRef.current = requestAnimationFrame(runClosingPulse);
  };

  const startClosingPulse = () => {
    if (pulseFrameRef.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderRangePreview(0.5);
      return;
    }
    pulseStartedAtRef.current = performance.now();
    renderRangePreview(0);
    pulseFrameRef.current = requestAnimationFrame(runClosingPulse);
  };

  // an anchoring path hit-tests, so aim lands on the entity rather than the
  // cursor. everything else unprojects, snapped to its first vertex when that
  // would close the path
  const aimTarget = (
    point: { x: number; y: number },
    anchors: boolean,
    pickedPathVertex?: PathVertexTarget | null,
  ): GeoPosition | undefined => {
    if (anchors) {
      const resolution = resolveRangeAtScreenPoint(point, undefined, pickedPathVertex);
      if (!resolution) return undefined;
      return resolution.point.type === "entity"
        ? entityMap.get(resolution.point.entityId)?.position
        : resolution.point.position;
    }
    const position = mapRef.current?.getMap().unproject([point.x, point.y]);
    if (!position) return undefined;
    return drawingTapPosition(point, { lat: position.lat, lng: wrapLongitude(position.lng) });
  };

  const renderRangeAim = (
    point: { x: number; y: number },
    pickedPathVertex?: PathVertexTarget | null,
  ) => {
    const drawing = placingPath();
    const source = drawing?.vertices.at(-1)?.position;
    const target = drawing && aimTarget(point, drawing.anchors ?? false, pickedPathVertex);
    if (!source || !target || (source.lat === target.lat && source.lng === target.lng)) {
      pathPreviewRef.current = null;
      stopClosingPulse();
      applyRangeInteractionLayers([]);
      return;
    }

    const label = getRangePreviewLabelRef.current?.(source, target) ?? "";
    const closingVertex = closingVertexAt(point);
    pathPreviewRef.current = { preview: { source, target, label }, closingVertex };
    if (closingVertex) startClosingPulse();
    else {
      stopClosingPulse();
      renderRangePreview();
    }
  };

  const updateRangeAim = (
    point: { x: number; y: number },
    pickedPathVertex?: PathVertexTarget | null,
  ) => {
    pathAimPointRef.current = point;
    if (!placingPath()?.drawsAsPath) {
      stopClosingPulse();
      applyRangeInteractionLayers([]);
      return;
    }
    renderRangeAim(point, pickedPathVertex);
  };

  const clearRangeAim = () => {
    pathAimPointRef.current = null;
    pathPreviewRef.current = null;
    stopClosingPulse();
    applyRangeInteractionLayers([]);
  };

  useEffect(() => {
    refreshRangeAimRef.current = () => {
      const point = pathAimPointRef.current;
      if (point) updateRangeAim(point);
    };
  });

  const commitPlacementAtScreenPoint = (
    point: { x: number; y: number },
    coordinate?: GeoPosition,
  ) => {
    if (placingPath()?.anchors) {
      commitRangeAtScreenPoint(point, coordinate);
      return;
    }
    const position = coordinate ?? mapRef.current?.getMap().unproject([point.x, point.y]);
    if (!position) return;
    // the leg the preview was drawing has just been placed
    clearRangeAim();
    void onMapClickRef.current?.({
      type: "coordinate",
      position: drawingTapPosition(point, {
        lat: position.lat,
        lng: wrapLongitude(position.lng),
      }),
    });
  };

  const commitRangeAtScreenPoint = (point: { x: number; y: number }, coordinate?: GeoPosition) => {
    const commit = resolveRangeAtScreenPoint(point, coordinate);
    if (!commit) return;
    clearRangeAim();
    if (commit.point.type === "entity") {
      commitRangeEntity(commit.point.entityId);
    } else {
      void onMapClickRef.current?.(commit.point);
    }
  };

  // the map panned with the cursor, so the release point is still the target
  const commitRangeAfterSlippedClick = (
    event: React.PointerEvent,
    elapsedMs: number,
    slidePx: number,
  ) => {
    if (activeToolRef.current === "none") return;
    if (!isDraggingRef.current) return;
    if (!isSlippedClick(elapsedMs, slidePx)) return;
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    commitPlacementAtScreenPoint({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const setupRangeDrag = (map: ReturnType<NonNullable<typeof mapRef.current>["getMap"]>) => {
    let draggedPoint: MapClickPoint | null = null;

    return setupMapGestureDrag({
      map,
      hitTest: ({ x, y }) => {
        draggedPoint = null;
        return pickPathVertexTarget(x, y);
      },
      onTap: (_, coordinate) => {
        if (suppressRangeTapRef.current) {
          suppressRangeTapRef.current = false;
          return;
        }
        // A claimed vertex tap cannot reach the map click route, so this handler owns its commit.
        if (resolveClaimedVertexTap(activeToolRef.current) === "commit-range") {
          commitRangeAtScreenPoint(coordinate.point, coordinate.position);
          return;
        }
        // pressing a vertex captures the pointer, so a tap meant to close the
        // ring never reaches the map's click handler
        const closing = closingVertexAt(coordinate.point);
        if (closing) {
          clearRangeAim();
          void onMapClickRef.current?.({ type: "coordinate", position: closing.position });
          return;
        }
        const entityId = pickEntityId(coordinate.point.x, coordinate.point.y);
        if (entityId) {
          lastLayerClickTimeRef.current = Date.now();
          void onEntityClickRef.current?.(entityId);
        }
      },
      onMove: (target, { point, position }) => {
        clearRangeAim();
        setCursor("grabbing");
        const entityId = pathAnchors(pathDataRef.current, target.pathId)
          ? pickEntityId(point.x, point.y)
          : null;
        draggedPoint = entityId ? { type: "entity", entityId } : { type: "coordinate", position };
        void onPathDragRef.current?.(target.pathId, target.sourceIndex, draggedPoint, "move");
      },
      onRelease: (target) => {
        setCursor("grab");
        if (!draggedPoint) return;
        const releasedPoint = draggedPoint;
        draggedPoint = null;
        void onPathDragRef.current?.(target.pathId, target.sourceIndex, releasedPoint, "release");
      },
    });
  };

  const handleMapLoad = () => {
    onReady?.();

    if (actionsReadyCalledRef.current) return;
    actionsReadyCalledRef.current = true;

    const map = mapRef.current?.getMap();
    if (map) {
      const center = map.getCenter();
      setViewState({
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        samplingViewport: getSamplingViewport(),
      });
      setupRadialTriggers(map);
      pathDragCleanupRef.current = setupRangeDrag(map);

      // windows: the container sometimes reads 0 while the map is sizing, so
      // maplibre sticks at a small fallback size and never recovers. resize on
      // mismatch, debounced so window drags don't thrash it.
      const container = map.getContainer();
      const reconcileSize = () => {
        const canvas = map.getCanvas();
        if (
          canvas.clientWidth !== container.clientWidth ||
          canvas.clientHeight !== container.clientHeight
        ) {
          map.resize();
        }
      };
      sizeObserverRef.current = new ResizeObserver(() => {
        if (sizeReconcileTimerRef.current) clearTimeout(sizeReconcileTimerRef.current);
        sizeReconcileTimerRef.current = setTimeout(reconcileSize, 150);
      });
      sizeObserverRef.current.observe(container);
      reconcileSize();
    }

    const actions: MapActions = {
      flyTo: (position, options) => {
        lastLayerClickTimeRef.current = Date.now();
        isAnimatingRef.current = true;
        mapRef.current?.flyTo({
          center: [position.lng, position.lat],
          zoom: options?.zoom,
          duration: (options?.duration ?? 1.5) * 1000,
        });
      },
      zoomIn: () => {
        isAnimatingRef.current = true;
        mapRef.current?.zoomIn({ duration: 400 });
      },
      zoomOut: () => {
        isAnimatingRef.current = true;
        mapRef.current?.zoomOut({ duration: 400 });
      },
      getView: () => {
        const vs = viewStateRef.current;
        return { lat: vs.latitude, lng: vs.longitude, zoom: vs.zoom };
      },
    };
    onActionsReady?.(actions);
  };

  const trackedEntity = trackedId ? entityMap.get(trackedId) : null;

  useEffect(() => {
    if (trackedId) {
      if (trackedEntity?.position) {
        const pos = trackedEntity.position;
        const lastPos = lastTrackedPositionRef.current;

        if (!lastPos || lastPos.lat !== pos.lat || lastPos.lng !== pos.lng) {
          lastTrackedPositionRef.current = { lat: pos.lat, lng: pos.lng };
          mapRef.current?.easeTo({
            center: [pos.lng, pos.lat],
            duration: 300,
          });
        }
      } else {
        if (lastTrackedPositionRef.current) {
          lastTrackedPositionRef.current = null;
          onTrackingLost?.();
        }
      }
    } else {
      lastTrackedPositionRef.current = null;
    }
  }, [trackedId, trackedEntity, onTrackingLost]);

  // Sync plugin-published map layers with the underlying maplibre map
  const mountedMapLayersRef = useRef(new Map<string, string>());
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const ensure = () => {
      const wanted = new Set<string>();

      // Sort by zIndex so higher renders on top
      const mapLayers = [...entityMap.values()]
        .flatMap((e) => (e.mapLayer ? [{ id: e.id, layer: e.mapLayer }] : []))
        .sort((a, b) => {
          const za = a.layer.zIndex ?? 0;
          const zb = b.layer.zIndex ?? 0;
          return za === zb ? a.id.localeCompare(b.id) : za - zb;
        });

      for (const { id, layer } of mapLayers) {
        if (hiddenMapLayerIds?.has(id)) continue;
        // mbtiles render via mapStyle, not here.
        if (layer.url?.startsWith("/tiles/")) continue;
        wanted.add(id);

        const sourceId = `plugin-map-layer-${id}`;
        const layerId = sourceId;
        const last = mountedMapLayersRef.current.get(id);
        const opacity = mapLayerOpacityOverrides?.[id] ?? (layer.opacity || 1);

        if (last && last !== layer.url) {
          for (const ml of map.getStyle().layers ?? []) {
            if (ml.id === layerId || ml.id.startsWith(sourceId + "-")) {
              map.removeLayer(ml.id);
            }
          }
          if (map.getSource(sourceId)) map.removeSource(sourceId);
          mountedMapLayersRef.current.delete(id);
        }

        if (!map.getSource(sourceId)) {
          if (layer.kind === "tiles") {
            map.addSource(sourceId, {
              type: "raster",
              tiles: [`${API_BASE}/map/${id}/{z}/{x}/{y}.png`],
              tileSize: 256,
            });
          } else {
            map.addSource(sourceId, {
              type: "image",
              url: `${API_BASE}/map/${id}/image`,
              coordinates: [
                [layer.west!, layer.north!],
                [layer.east!, layer.north!],
                [layer.east!, layer.south!],
                [layer.west!, layer.south!],
              ],
            });
          }
          map.addLayer({ id: layerId, type: "raster", source: sourceId });
        } else if (layer.kind === "image") {
          (map.getSource(sourceId) as ImageSource).setCoordinates([
            [layer.west!, layer.north!],
            [layer.east!, layer.north!],
            [layer.east!, layer.south!],
            [layer.west!, layer.south!],
          ]);
        }

        map.setPaintProperty(layerId, "raster-opacity", opacity);
        mountedMapLayersRef.current.set(id, layer.url);
      }

      // Drop layers for hidden entities.
      // Vector tilesets match by prefix instead of exact id.
      for (const id of [...mountedMapLayersRef.current.keys()]) {
        if (wanted.has(id)) continue;
        const sourceId = `plugin-map-layer-${id}`;
        for (const ml of map.getStyle().layers ?? []) {
          if (ml.id === sourceId || ml.id.startsWith(sourceId + "-")) {
            map.removeLayer(ml.id);
          }
        }
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        mountedMapLayersRef.current.delete(id);
      }
    };

    const onStyleLoad = () => {
      mountedMapLayersRef.current.clear();
      ensure();
    };
    if (map.isStyleLoaded()) ensure();
    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [entityMap, lastChange?.version, hiddenMapLayerIds, mapLayerOpacityOverrides, baseLayer]);

  const version = lastChange?.version ?? 0;
  if (version !== lastShapeVersionRef.current) {
    lastShapeVersionRef.current = version;

    let shapesChanged = false;
    const updatedIds = lastChange?.updatedIds;

    if (updatedIds) {
      for (const id of updatedIds) {
        const hasShape = !!entityMap.get(id)?.shape;
        if (hasShape) {
          shapeEntityIdsRef.current.add(id);
          shapesChanged = true;
        } else if (shapeEntityIdsRef.current.delete(id)) {
          shapesChanged = true;
        }
      }
    }

    for (const id of shapeEntityIdsRef.current) {
      if (!entityMap.has(id)) {
        shapeEntityIdsRef.current.delete(id);
        shapesChanged = true;
      }
    }

    if (shapesChanged) {
      const shapeFeatures: ShapeFeature[] = [];
      for (const id of shapeEntityIdsRef.current) {
        const e = entityMap.get(id);
        if (!e?.shape) continue;
        const affiliation = e.affiliation ?? "unknown";
        shapeFeatures.push(...shapeToFeatures(e.id, e.shape, affiliation, e.isDrawn));
      }
      shapesCollectionRef.current = { type: "FeatureCollection", features: shapeFeatures };
    }
  }

  const integerZoom = Math.floor(viewState.zoom);
  const showSectors = integerZoom >= SECTOR_MIN_ZOOM && detectionsVisible;

  const handleEntityClick = (id: string): boolean => {
    const decision = resolveEntityLayerClick(
      activeToolRef.current,
      placingPath()?.anchors === true,
      "entity",
    );
    if (decision === "refuse") return false;

    lastLayerClickTimeRef.current = Date.now();
    // a tool that anchors takes the entity as its point rather than selecting it
    if (decision === "anchor") {
      commitRangeEntity(id);
      return true;
    }
    if (expandedAssemblies && expandedAssemblies.size > 0) {
      const parentId = entityMap.get(id)?.assemblyParentId;
      const isInsideAssembly =
        expandedAssemblies.has(id) || (parentId != null && expandedAssemblies.has(parentId));
      if (!isInsideAssembly) {
        setExpandedAssemblies(null);
        assemblyMinZoomRef.current = null;
      }
    }
    void onEntityClickRef.current?.(id);
    return true;
  };

  const handleClusterClick = (
    _clusterId: string,
    lat: number,
    lng: number,
    expansionZoom: number,
  ): boolean => {
    const decision = resolveEntityLayerClick(
      activeToolRef.current,
      placingPath()?.anchors === true,
      "cluster",
    );
    if (decision === "refuse") return false;

    if (decision === "place") {
      clearRangeAim();
      void onMapClickRef.current?.({ type: "coordinate", position: { lat, lng } });
      return true;
    }
    lastLayerClickTimeRef.current = Date.now();
    isAnimatingRef.current = true;
    if (expandedAssemblies) {
      setExpandedAssemblies(null);
      assemblyMinZoomRef.current = null;
    }
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: Math.min(expansionZoom + 1, 20),
      speed: 1.2,
    });
    return true;
  };

  const handleAssemblyExpand = (rootId: string) => {
    const root = entityMap.get(rootId);
    if (!root?.position) return;

    let minLat = root.position.lat;
    let maxLat = root.position.lat;
    let minLng = root.position.lng;
    let maxLng = root.position.lng;
    for (const e of entityMap.values()) {
      if (e.assemblyParentId === rootId && e.position) {
        minLat = Math.min(minLat, e.position.lat);
        maxLat = Math.max(maxLat, e.position.lat);
        minLng = Math.min(minLng, e.position.lng);
        maxLng = Math.max(maxLng, e.position.lng);
      }
    }

    // Only auto-zoom when children are geographically spread (~11m+).
    // Colocated children (e.g. sensors on a person) use pixel-offset spread instead.
    const isSpread = maxLat - minLat > 0.0001 || maxLng - minLng > 0.0001;

    if (isSpread) {
      const map = mapRef.current;
      if (map) {
        const cam = map.cameraForBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 120 },
        );
        if (cam?.zoom != null) {
          assemblyMinZoomRef.current = Math.floor(cam.zoom) - 2;
          if (cam.zoom > viewState.zoom) {
            lastLayerClickTimeRef.current = Date.now();
            isAnimatingRef.current = true;
            map.flyTo({ center: cam.center, zoom: cam.zoom, duration: 800 });
          }
        }
      }
    }

    setExpandedAssemblies(new Set([rootId]));
  };

  const map = mapRef.current;
  const container = map?.getContainer();
  const vpWidth = container?.clientWidth ?? 1200;
  const vpHeight = container?.clientHeight ?? 800;

  const needsGroundScale =
    bullseyeCenter !== null || (pathData?.paths.some((path) => path.segments.length > 0) ?? false);
  let metersPerPx: number | null = null;
  if (map && needsGroundScale) {
    const y = vpHeight / 2;
    const p0 = map.unproject([vpWidth / 2, y]);
    const p1 = map.unproject([vpWidth / 2 + 1, y]);
    metersPerPx = p0.distanceTo(p1);
  }

  const pathAnchorEntityIds = [
    ...new Set(
      (pathData?.paths ?? []).flatMap((path) =>
        isPathLegible(path, metersPerPx)
          ? path.vertices.flatMap((vertex) => (vertex.entityId ? [vertex.entityId] : []))
          : [],
      ),
    ),
  ];

  const {
    layers: clusterLayers,
    selectionData,
    labelData,
    coverageEntities,
    renderedEntityIds,
  } = useEntityClusters({
    entityMap,
    lastChange,
    filter,
    selectedId,
    shapesVisible,
    detectionsVisible,
    clusteringEnabled,
    zoom: viewState.zoom,
    pickable: activeTool !== "bullseye",
    placementActive: activeTool !== "none",
    overlapOffsets,
    expandedAssemblies,
    unclusteredIds: pathAnchorEntityIds,
    onEntityClick: handleEntityClick,
    onClusterClick: handleClusterClick,
    onOverlapSpread: (offsets) => {
      overlapActivationZoomRef.current = Math.floor(viewState.zoom);
      setOverlapOffsets(offsets);
    },
    onAssemblyExpand: handleAssemblyExpand,
    onAssemblyCollapse: () => {
      setExpandedAssemblies(null);
      assemblyMinZoomRef.current = null;
    },
  });

  const coverageShapeIds = new Set<string>();
  const trackShapeIds = new Set<string>();
  for (const entity of entityMap.values()) {
    if (entity.coverageEntityIds) {
      for (const covId of entity.coverageEntityIds) coverageShapeIds.add(covId);
    }
    if (entity.trackHistoryId) trackShapeIds.add(entity.trackHistoryId);
    if (entity.trackPredictionId) trackShapeIds.add(entity.trackPredictionId);
  }

  const coverageFeatures: ShapeFeature[] = [];
  for (const entity of coverageEntities) {
    if (!entity.coverageEntityIds) continue;
    if (!coverageVisible && entity.id !== selectedId) continue;
    for (const covId of entity.coverageEntityIds) {
      const covEntity = entityMap.get(covId);
      if (covEntity?.shape) {
        coverageFeatures.push(
          ...shapeToFeatures(covId, covEntity.shape, covEntity.affiliation ?? "unknown"),
        );
      }
    }
  }

  const sectorData: SectorRenderData[] = [];
  if (showSectors) {
    for (const entity of coverageEntities) {
      const sector = prepareSectorData(entity, colorScheme);
      if (sector) sectorData.push(sector);
    }
  }

  const selectedEntity = selectedId ? entityMap.get(selectedId) : null;
  const selectedTrackShapeIds = new Set<string>();
  if (selectedEntity?.trackHistoryId) selectedTrackShapeIds.add(selectedEntity.trackHistoryId);
  if (selectedEntity?.trackPredictionId)
    selectedTrackShapeIds.add(selectedEntity.trackPredictionId);

  const assemblyOutlineIds = new Set<string>();
  const visibleAssemblyOutlineIds = new Set<string>();
  for (const entity of entityMap.values()) {
    if (!entity.assemblyOutlineIds) continue;
    // an outline only shows when its root is on the map
    const rootVisible = renderedEntityIds.has(entity.id);
    for (const id of entity.assemblyOutlineIds) {
      assemblyOutlineIds.add(id);
      if (rootVisible) visibleAssemblyOutlineIds.add(id);
    }
  }

  // @TODO: enable when detection entities reliably have pose.parent
  // const parentEntity = selectedEntity?.parentEntityId
  //   ? entityMap.get(selectedEntity.parentEntityId)
  //   : null;
  // const pairingLineData =
  //   selectedEntity && parentEntity
  //     ? {
  //         source: selectedEntity.position,
  //         target: parentEntity.position,
  //         affiliation: selectedEntity.affiliation ?? ("unknown" as const),
  //       }
  //     : null;

  const shapeCtx: ShapeVisibilityContext = {
    coverageShapeIds,
    assemblyOutlineIds,
    visibleAssemblyOutlineIds,
    trackShapeIds,
    filter,
    selectedId,
    selectedTrackShapeIds,
    entityMap,
    detectionsVisible,
    trackHistoryVisible,
    shapesVisible,
  };
  const samplingViewport = viewState.samplingViewport;
  const shapeWorker = useShapeWorker(pathData, editablePathId, viewState.zoom, samplingViewport);
  const localShapeFeatures: ShapeFeature[] = [];
  for (const path of pathData?.paths ?? []) {
    // the one still being placed is drawn imperatively, so it can follow the
    // pointer without waiting for a render
    if (path.kind === "range" || path.id === pathData?.drawingId) continue;
    const stored = entityMap.get(path.id);
    const prepared =
      path.id === editablePathId
        ? undefined
        : shapeWorker?.prepared(path, viewState.zoom, samplingViewport);
    const features = drawingPreviewFeatures(
      {
        path,
        zoom: viewState.zoom,
        viewport: samplingViewport,
        affiliation: stored?.affiliation ?? "unclassified",
      },
      prepared,
    );
    const unresolved = path.vertices.some((vertex) => vertex.unresolved);
    localShapeFeatures.push(
      ...features.map((feature) =>
        unresolved
          ? { ...feature, properties: { ...feature.properties, lineStyle: "dashed" as const } }
          : feature,
      ),
    );
  }

  const localShapeIds = new Set(localShapeFeatures.map((f) => f.properties.id));
  const renderedShapes = localShapeIds.size
    ? [
        ...shapesCollectionRef.current.features.filter((f) => !localShapeIds.has(f.properties.id)),
        ...localShapeFeatures,
      ]
    : shapesCollectionRef.current.features;
  const visibleShapes = renderedShapes.filter((f) =>
    isShapeVisible(f.properties.id, f.properties.affiliation, shapeCtx),
  );

  // A shape under the pointer is scenery while a tool is placing. Refusing the
  // click is what lets it fall through and place the point.
  const handleShapeClick = (id: string): boolean => {
    if (activeToolRef.current !== "none") return false;
    onEntityClickRef.current?.(id);
    return true;
  };

  const handlePathClick = (pathId: string): boolean => {
    if (activeToolRef.current !== "none" || !entityMap.has(pathId)) return false;
    onEntityClickRef.current?.(pathId);
    return true;
  };

  let bullseyeResult: ReturnType<typeof createBullseyeLayers> | null = null;
  if (bullseyeCenter && map && metersPerPx !== null) {
    // Same projection + rounding the ScaleControl uses internally
    const SCALE_BAR_MAX_PX = 100;
    const y = vpHeight / 2;
    const left = map.unproject([0, y]);
    const right = map.unproject([SCALE_BAR_MAX_PX, y]);
    const maxMeters = left.distanceTo(right);
    const scaleBarDistanceM = getRoundNum(maxMeters);

    bullseyeResult = createBullseyeLayers({
      center: bullseyeCenter,
      scaleBarDistanceM,
      metersPerPx,
      viewportWidth: vpWidth,
      viewportHeight: vpHeight,
      baseLayer: onlineBaseLayer ?? "dark",
    });
  }

  const pathRenderData = downgradeHiddenPathAnchors(pathData, renderedEntityIds);

  const baseLayers: Layer[] = [
    ...createCoverageLayer({
      data: coverageFeatures,
      visible: coverageVisible || coverageFeatures.length > 0,
      baseLayer: onlineBaseLayer ?? "dark",
    }),
    createSensorSectorLayer({
      data: sectorData,
      visible: showSectors,
    }),
    ...createShapeLayer({
      drawnColor: pathLineColor(onlineBaseLayer ?? "dark"),
      fillColor: pathFillColor(onlineBaseLayer ?? "dark"),
      baseLayer: onlineBaseLayer ?? "dark",
      data: visibleShapes,
      visible: visibleShapes.length > 0,
      selectedId,
      onClick: handleShapeClick,
    }),
    ...(bullseyeResult?.layers ?? []),
    // @TODO: enable when detection entities reliably have pose.parent
    // createPairingLineLayer({ data: pairingLineData }),
    createSelectionLayer({
      data: selectionData,
    }),
    // a range and bearing never covers a symbol. the anchored ring is wider than an icon, so it still
    // reads from underneath.
    ...createPathLayers({
      data: pathRenderData,
      baseLayer: onlineBaseLayer ?? "dark",
      verticesPickable: true,
      metersPerPx,
      zoom: viewState.zoom,
      viewport: samplingViewport,
      projector: mapRef.current,
      onPathClick: handlePathClick,
      editablePathId,
      selectedId,
    }),
    ...clusterLayers,
    createLabelLayer({
      data: labelData,
      visible: fontLoaded && labelData.length > 0,
      baseLayer: onlineBaseLayer ?? "dark",
    }),
    ...(bullseyeResult ? [bullseyeResult.centerLayer] : []),
  ];
  useEffect(() => {
    baseLayersRef.current = baseLayers;
  });
  // preventDefault on the event does not reach maplibre's own handler, so the zoom
  // comes off entirely while a double-click means "done". touch never gets that far,
  // so it keeps the native double-tap zoom.
  useEffect(() => {
    const zoom = mapRef.current?.getMap().doubleClickZoom;
    if (!zoom) return;
    if (
      shouldFinishOnDoubleClick(
        pointerType,
        placingPath()?.endsByGesture === true,
        editablePathId !== null,
      )
    )
      zoom.disable();
    else zoom.enable();
  }, [activeTool, pathData, editablePathId, pointerType]);

  useEffect(() => {
    setCursor(
      resolveMapCursor({
        activeTool,
        editablePathId,
        anchors: false,
        picked: false,
        pickedAnchorableEntity: false,
        pickedPathVertex: false,
        dragging: isDraggingRef.current,
      }),
    );
  }, [activeTool, editablePathId]);

  useEffect(() => {
    if (activeTool !== "none") {
      refreshRangeAimRef.current();
      return;
    }
    pathAimPointRef.current = null;
    pathPreviewRef.current = null;
    pathInteractionLayersRef.current = [];
    applyOverlayLayers();
  }, [activeTool, pathData, onlineBaseLayer]);
  const layers = overlayLayers(baseLayers);

  const handleClick = (info: PickingInfo) => {
    const point = { x: info.x, y: info.y };
    switch (
      resolveMapClick({
        activeTool,
        isDragging: isDraggingRef.current,
        isAnimating: isAnimatingRef.current,
        hasCoordinate: info.coordinate !== undefined,
        picked: info.picked,
        msSinceLayerClick: Date.now() - lastLayerClickTimeRef.current,
      })
    ) {
      case "commit-range":
        commitRangeAtScreenPoint(point);
        return;
      case "commit-placement":
        commitPlacementAtScreenPoint(point, {
          lat: info.coordinate![1]!,
          lng: info.coordinate![0]!,
        });
        return;
      case "clear-selection":
        if (overlapOffsets) setOverlapOffsets(null);
        if (expandedAssemblies) setExpandedAssemblies(null);
        overlapActivationZoomRef.current = null;
        assemblyMinZoomRef.current = null;
        onEntityClickRef.current?.(null);
        return;
      case "ignore":
        return;
    }
  };

  const handleHover = (info: PickingInfo) => {
    lastHoverPointRef.current = info.x < 0 || info.y < 0 ? null : { x: info.x, y: info.y };
    if (activeToolRef.current === "drawing") updateDrawingPreview(lastHoverPointRef.current);

    const pickedPathVertex =
      info.layer?.id === PATH_VERTEX_LAYER_ID ? findPickedPathVertexTarget(info.object) : null;
    const placing = placingPath();
    if (placing?.drawsAsPath && pointerTypeRef.current !== "touch") {
      // deck signals pointer-leave as a hover at (-1, -1)
      if (info.x < 0 || info.y < 0) clearRangeAim();
      else updateRangeAim({ x: info.x, y: info.y }, pickedPathVertex);
    }
    setCursor(
      resolveMapCursor({
        activeTool,
        editablePathId,
        anchors:
          placing?.anchors === true ||
          (editablePathId !== null && pathAnchors(pathDataRef.current, editablePathId)),
        picked: info.picked,
        pickedAnchorableEntity: findPickedEntityId([info.object]) !== null,
        pickedPathVertex: pickedPathVertex !== null,
        dragging: isDraggingRef.current,
      }),
    );
  };

  const drawingAimPoint = () => {
    // touch has no hover, so there is no aim point between taps. what has been
    // placed still draws; only the leg to an un-placed point goes.
    if (pointerTypeRef.current === "touch") return null;
    return lastHoverPointRef.current;
  };

  useEffect(() => {
    updateDrawingPreview(activeTool === "drawing" ? drawingAimPoint() : null);
  }, [activeTool, pathData]);

  const lastIntegerZoomRef = useRef(-1);

  const refreshRangeAimAfterMapMove = () => {
    if (activeToolRef.current === "drawing") updateDrawingPreview(drawingAimPoint());
    if (!placingPath()?.drawsAsPath) return;
    const point = pathAimPointRef.current;
    if (point) updateRangeAim(point);
  };

  const handleMove = (evt: ViewStateChangeEvent) => {
    const previousViewport = samplingViewportRef.current?.viewport;
    const viewport = getSamplingViewport();
    refreshRangeAimAfterMapMove();

    const newIntegerZoom = Math.floor(evt.viewState.zoom);
    const integerZoomChanged = newIntegerZoom !== lastIntegerZoomRef.current;

    if (integerZoomChanged) {
      lastIntegerZoomRef.current = newIntegerZoom;

      if (!isAnimatingRef.current) {
        const overlapZoom = overlapActivationZoomRef.current;
        if (overlapZoom !== null && newIntegerZoom < overlapZoom - OVERLAP_ZOOM_TOLERANCE) {
          if (overlapOffsets) setOverlapOffsets(null);
          overlapActivationZoomRef.current = null;
        }

        const asmZoom = assemblyMinZoomRef.current;
        if (asmZoom !== null && newIntegerZoom < asmZoom) {
          if (expandedAssemblies) setExpandedAssemblies(null);
          assemblyMinZoomRef.current = null;
        }
      }
    }
    if (integerZoomChanged || viewport !== previousViewport) {
      setViewState({
        longitude: evt.viewState.longitude,
        latitude: evt.viewState.latitude,
        zoom: evt.viewState.zoom,
        samplingViewport: viewport,
      });
    }
  };

  const handleMoveEnd = (evt: ViewStateChangeEvent) => {
    refreshRangeAimAfterMapMove();

    lastIntegerZoomRef.current = Math.floor(evt.viewState.zoom);
    setViewState({
      longitude: evt.viewState.longitude,
      latitude: evt.viewState.latitude,
      zoom: evt.viewState.zoom,
      samplingViewport: getSamplingViewport(),
    });
    onViewChange?.(evt.viewState.latitude, evt.viewState.longitude, evt.viewState.zoom);
    // Delay clearing animation flag to let layers re-render after zoom
    setTimeout(() => {
      isAnimatingRef.current = false;
    }, 200);
  };

  const offlineBasemap = onlineBaseLayer ? null : entityMap?.get(baseLayer)?.mapLayer;
  const mapStyle = offlineBasemap
    ? buildOfflineStyle(offlineBasemap)
    : STYLES[onlineBaseLayer ?? "dark"];

  return (
    <div
      style={{ width: "100%", height: "100%", position: "relative", zIndex: 0 }}
      onPointerDown={(event) => {
        if (event.pointerType !== pointerTypeRef.current) {
          pointerTypeRef.current = event.pointerType;
          setPointerType(event.pointerType);
        }
        pressRef.current = { t: performance.now(), x: event.clientX, y: event.clientY };
        void onPointerTypeChange?.(event.pointerType);
      }}
      onPointerUp={(event) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press) return;
        commitRangeAfterSlippedClick(
          event,
          performance.now() - press.t,
          Math.hypot(event.clientX - press.x, event.clientY - press.y),
        );
      }}
    >
      <MapGL
        ref={mapRef}
        mapStyle={mapStyle}
        attributionControl={false}
        initialViewState={resolvedInitialView}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
        // a map already loaded when the handler attaches never fires onLoad, so idle
        // is the fallback that gets actions wired. handleMapLoad guards itself.
        onIdle={handleMapLoad}
        onDragStart={() => {
          if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
            dragTimeoutRef.current = null;
          }
          isDraggingRef.current = true;
          setCursor("grabbing");
        }}
        onDragEnd={() => {
          setCursor("grab");
          dragTimeoutRef.current = setTimeout(() => {
            isDraggingRef.current = false;
            dragTimeoutRef.current = null;
          }, 300);
        }}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
      >
        <DeckGLOverlay
          layers={layers}
          pickingRadius={PATH_VERTEX_PICK_RADIUS}
          onClick={handleClick}
          onHover={handleHover}
          onOverlayReady={(overlay) => {
            overlayRef.current = overlay;
          }}
        />
        <ScaleControl position="bottom-left" maxWidth={100} unit="metric" />
      </MapGL>
      {isPlacing && (
        <CenterReticle
          baseLayer={onlineBaseLayer ?? "dark"}
          coordinateColors={placementCoordColors}
          position={{ lat: viewState.latitude, lng: viewState.longitude }}
        />
      )}
    </div>
  );
}
