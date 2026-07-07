import "maplibre-gl/dist/maplibre-gl.css";
import "./overrides.css";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { FeatureCollection } from "geojson";
import type { MapMouseEvent, MapTouchEvent, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { MapRef, ViewStateChangeEvent } from "react-map-gl/maplibre";
import { Map as MapGL, ScaleControl, useControl } from "react-map-gl/maplibre";

import { BASE_LAYER_SOURCES, DEFAULT_POSITION } from "../../constants";
import {
  createCoverageLayer,
  createLabelLayer,
  createRangeRingsLayers,
  createSelectionLayer,
  createSensorSectorLayer,
  createShapeLayer,
  prepareSectorData,
  type SectorRenderData,
  useEntityClusters,
} from "../../layers";
import type {
  BaseLayer,
  EntityData,
  EntityFilter,
  GeoPosition,
  MapLayer,
  ShapeFeature,
  ShapeProperties,
} from "../../types";
import { shapeToFeatures } from "../../utils/shape-to-geojson";
import { isShapeVisible, type ShapeVisibilityContext } from "../../utils/shape-visibility";
// source: https://github.com/openmaptiles/positron-gl-style/blob/master/style.json
import openmaptilesStyle from "./assets/openmaptiles-style.json";

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

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
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
    overlay.setProps({ layers, pickingRadius, onClick, onHover });
  } catch {
    // map state is mid-rebuild after gl context loss; next render picks up
  }
  return null;
}

type RasterPaint = {
  "raster-brightness-max"?: number;
  "raster-brightness-min"?: number;
  "raster-saturation"?: number;
};

const createRasterStyle = (
  tiles: string[],
  attribution: string,
  maxZoom = 20,
  paint: RasterPaint = {},
  backgroundColor = "#000000",
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
    { id: "background", type: "background", paint: { "background-color": backgroundColor } },
    { id: "raster-layer", type: "raster", source: "raster", paint },
  ],
});

// mbtiles as full style so maplibre swaps at once.
function buildOfflineStyle(layer: MapLayer): StyleSpecification {
  const path = `${API_BASE}${layer.url}`;
  const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
  if (layer.url.endsWith(".pbf")) {
    const base = openmaptilesStyle as unknown as StyleSpecification;
    return {
      ...base,
      sources: { openmaptiles: { type: "vector", tiles: [url] } },
      layers: base.layers.filter((l) => l.type !== "symbol"),
    };
  }
  return createRasterStyle([url], "", 22);
}

const STYLES: Record<BaseLayer, StyleSpecification> = {
  dark: createRasterStyle(
    ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
    BASE_LAYER_SOURCES.dark.attribution,
    BASE_LAYER_SOURCES.dark.maxZoom,
  ),
  satellite: createRasterStyle(
    [BASE_LAYER_SOURCES.satellite.url],
    BASE_LAYER_SOURCES.satellite.attribution,
    BASE_LAYER_SOURCES.satellite.maxZoom,
  ),
  street: createRasterStyle(
    ["a", "b", "c", "d"].map(
      (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`,
    ),
    BASE_LAYER_SOURCES.street.attribution,
    BASE_LAYER_SOURCES.street.maxZoom,
    { "raster-brightness-max": 0.87, "raster-brightness-min": 0.1 },
    "#e8e0d8",
  ),
};

const isBaseLayer = (s: string): s is BaseLayer => Object.hasOwn(STYLES, s);

const DEFAULT_FILTER: EntityFilter = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: {},
};

const PLACEMENT_RETICLE: Record<BaseLayer, { accent: string; shadow: string }> = {
  dark: { accent: "rgb(16, 185, 129)", shadow: "rgba(0, 0, 0, 0.85)" },
  satellite: { accent: "rgb(255, 255, 255)", shadow: "rgba(0, 0, 0, 0.85)" },
  street: { accent: "rgb(15, 23, 42)", shadow: "rgba(255, 255, 255, 0.9)" },
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
  rangeRingCenter?: GeoPosition | null;
  rangeRingsActive?: boolean;
  hiddenMapLayerIds?: ReadonlySet<string>;
  mapLayerOpacityOverrides?: Readonly<Record<string, number>>;
  isPlacing?: boolean;
  placementCoordColors?: PlacementCoordColors;
  onEntityClick?: (id: string | null) => void | Promise<void>;
  onMapClick?: (lat: number, lng: number) => void | Promise<void>;
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
  rangeRingCenter = null,
  rangeRingsActive = false,
  hiddenMapLayerIds,
  mapLayerOpacityOverrides,
  isPlacing = false,
  placementCoordColors,
  onEntityClick,
  onMapClick,
  onRadialRequest,
  onReady,
  onActionsReady,
  onTrackingLost,
  onViewChange,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const onlineBaseLayer: BaseLayer | null = isBaseLayer(baseLayer) ? baseLayer : null;
  const resolvedInitialView = initialView
    ? { longitude: initialView.lng, latitude: initialView.lat, zoom: initialView.zoom }
    : INITIAL_VIEW_STATE;
  const [viewState, setViewState] = useState<ViewState>(resolvedInitialView);
  const [fontLoaded, setFontLoaded] = useState(false);
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  // Keep callback refs current to avoid stale closures in deck.gl layers
  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onRadialRequestRef = useRef(onRadialRequest);
  onRadialRequestRef.current = onRadialRequest;
  const overlayRef = useRef<MapboxOverlay | null>(null);
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
  const [overlapOffsets, setOverlapOffsets] = useState<Map<string, [number, number]> | null>(null);
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string> | null>(null);
  const overlapActivationZoomRef = useRef<number | null>(null);
  const assemblyMinZoomRef = useRef<number | null>(null);
  const sizeObserverRef = useRef<ResizeObserver | null>(null);
  const sizeReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.fonts.load("16px Inter").then(() => setFontLoaded(true));
  }, []);

  useEffect(() => {
    return () => {
      sizeObserverRef.current?.disconnect();
      if (sizeReconcileTimerRef.current) clearTimeout(sizeReconcileTimerRef.current);
    };
  }, []);

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
  }, [selectedId, entityMap]);

  // Open radial for whatever is under the pointer.
  // Right click on web, long press on touch (manual for Android).
  const setupRadialTriggers = (map: ReturnType<NonNullable<typeof mapRef.current>["getMap"]>) => {
    const fire = (e: MapMouseEvent | MapTouchEvent) => {
      const info = overlayRef.current?.pickObject({ x: e.point.x, y: e.point.y, radius: 8 });
      const id = (info?.object as { entity?: { id: string } } | null)?.entity?.id ?? null;
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
      holdTimer = setTimeout(() => fire(e), 450);
    });
    map.on("touchmove", cancelHold);
    map.on("touchend", cancelHold);
  };

  const handleMapLoad = () => {
    onReady?.();

    if (actionsReadyCalledRef.current) return;
    actionsReadyCalledRef.current = true;

    const map = mapRef.current?.getMap();
    if (map) {
      setupRadialTriggers(map);

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
        // Remount map layers when bbox changes
        const signature =
          layer.kind === "tiles"
            ? layer.url
            : `${layer.url}|${layer.west},${layer.south},${layer.east},${layer.north}`;
        const lastSignature = mountedMapLayersRef.current.get(id);
        const opacity = mapLayerOpacityOverrides?.[id] ?? (layer.opacity || 1);

        if (lastSignature && lastSignature !== signature) {
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
          map.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
            paint: { "raster-opacity": opacity },
          });
          mountedMapLayersRef.current.set(id, signature);
        } else {
          map.setPaintProperty(layerId, "raster-opacity", opacity);
        }
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
        shapeFeatures.push(...shapeToFeatures(e.id, e.shape, affiliation));
      }
      shapesCollectionRef.current = { type: "FeatureCollection", features: shapeFeatures };
    }
  }

  const integerZoom = Math.floor(viewState.zoom);
  const showSectors = integerZoom >= SECTOR_MIN_ZOOM && detectionsVisible;

  const handleEntityClick = async (id: string) => {
    lastLayerClickTimeRef.current = Date.now();
    if (expandedAssemblies && expandedAssemblies.size > 0) {
      const parentId = entityMap.get(id)?.assemblyParentId;
      const isInsideAssembly =
        expandedAssemblies.has(id) || (parentId != null && expandedAssemblies.has(parentId));
      if (!isInsideAssembly) {
        setExpandedAssemblies(null);
        assemblyMinZoomRef.current = null;
      }
    }
    await onEntityClickRef.current?.(id);
  };

  const handleClusterClick = (
    _clusterId: string,
    lat: number,
    lng: number,
    expansionZoom: number,
  ) => {
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
    pickable: !rangeRingsActive,
    overlapOffsets,
    expandedAssemblies,
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
  const visibleShapes = shapesCollectionRef.current.features.filter((f) =>
    isShapeVisible(f.properties.id, f.properties.affiliation, shapeCtx),
  );

  const handleShapeClick = (id: string) => {
    onEntityClickRef.current?.(id);
  };

  const map = mapRef.current;
  const container = map?.getContainer();
  const vpWidth = container?.clientWidth ?? 1200;
  const vpHeight = container?.clientHeight ?? 800;

  let rangeRingResult: ReturnType<typeof createRangeRingsLayers> | null = null;
  if (rangeRingCenter && map) {
    // Same projection + rounding the ScaleControl uses internally
    const SCALE_BAR_MAX_PX = 100;
    const y = vpHeight / 2;
    const left = map.unproject([0, y]);
    const right = map.unproject([SCALE_BAR_MAX_PX, y]);
    const maxMeters = left.distanceTo(right);
    const scaleBarDistanceM = getRoundNum(maxMeters);

    // 1px ground distance at viewport center
    const p0 = map.unproject([vpWidth / 2, y]);
    const p1 = map.unproject([vpWidth / 2 + 1, y]);
    const metersPerPx = p0.distanceTo(p1);

    rangeRingResult = createRangeRingsLayers({
      center: rangeRingCenter,
      scaleBarDistanceM,
      metersPerPx,
      viewportWidth: vpWidth,
      viewportHeight: vpHeight,
      baseLayer: onlineBaseLayer ?? "dark",
    });
  }

  const layers: Layer[] = [
    createCoverageLayer({
      data: coverageFeatures,
      visible: coverageVisible || coverageFeatures.length > 0,
      baseLayer: onlineBaseLayer ?? "dark",
    }),
    createSensorSectorLayer({
      data: sectorData,
      visible: showSectors,
    }),
    createShapeLayer({
      data: visibleShapes,
      visible: visibleShapes.length > 0,
      selectedId,
      onClick: handleShapeClick,
    }),
    ...(rangeRingResult?.layers ?? []),
    // @TODO: enable when detection entities reliably have pose.parent
    // createPairingLineLayer({ data: pairingLineData }),
    createSelectionLayer({
      data: selectionData,
    }),
    ...clusterLayers,
    createLabelLayer({
      data: labelData,
      visible: fontLoaded && labelData.length > 0,
      baseLayer: onlineBaseLayer ?? "dark",
    }),
    ...(rangeRingResult ? [rangeRingResult.centerLayer] : []),
  ];

  const handleClick = (info: PickingInfo) => {
    if (isDraggingRef.current) return;
    if (isAnimatingRef.current) return;
    const msSinceLayerClick = Date.now() - lastLayerClickTimeRef.current;
    if (msSinceLayerClick < 500) return;
    if (rangeRingsActive && info.coordinate) {
      onMapClickRef.current?.(info.coordinate[1]!, info.coordinate[0]!);
      return;
    }
    if (!info.picked) {
      if (overlapOffsets) setOverlapOffsets(null);
      if (expandedAssemblies) setExpandedAssemblies(null);
      overlapActivationZoomRef.current = null;
      assemblyMinZoomRef.current = null;
      onEntityClickRef.current?.(null);
    }
  };

  const setCursor = (cursor: string) => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas && canvas.style.cursor !== cursor) {
      canvas.style.cursor = cursor;
    }
  };

  const handleHover = (info: PickingInfo) => {
    if (rangeRingsActive && !info.picked) {
      setCursor("crosshair");
    } else {
      setCursor(info.picked ? "pointer" : "grab");
    }
  };

  const lastIntegerZoomRef = useRef(-1);

  const handleMove = (evt: ViewStateChangeEvent) => {
    const newIntegerZoom = Math.floor(evt.viewState.zoom);

    if (newIntegerZoom !== lastIntegerZoomRef.current) {
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

      setViewState({
        longitude: evt.viewState.longitude,
        latitude: evt.viewState.latitude,
        zoom: evt.viewState.zoom,
      });
    }
  };

  const handleMoveEnd = (evt: ViewStateChangeEvent) => {
    lastIntegerZoomRef.current = Math.floor(evt.viewState.zoom);
    setViewState({
      longitude: evt.viewState.longitude,
      latitude: evt.viewState.latitude,
      zoom: evt.viewState.zoom,
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
    <div style={{ width: "100%", height: "100%", position: "relative", zIndex: 0 }}>
      <MapGL
        ref={mapRef}
        mapStyle={mapStyle}
        attributionControl={false}
        initialViewState={resolvedInitialView}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
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
          pickingRadius={8}
          onClick={handleClick}
          onHover={handleHover}
          onOverlayReady={(overlay) => {
            overlayRef.current = overlay;
          }}
        />
        <ScaleControl position="bottom-right" maxWidth={100} unit="metric" />
      </MapGL>
      {isPlacing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: `2px solid ${PLACEMENT_RETICLE[onlineBaseLayer ?? "dark"].accent}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 14px ${PLACEMENT_RETICLE[onlineBaseLayer ?? "dark"].shadow}, 0 0 6px ${PLACEMENT_RETICLE[onlineBaseLayer ?? "dark"].shadow}`,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: PLACEMENT_RETICLE[onlineBaseLayer ?? "dark"].accent,
                boxShadow: `0 0 5px ${PLACEMENT_RETICLE[onlineBaseLayer ?? "dark"].shadow}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                marginTop: 8,
                whiteSpace: "nowrap",
                backgroundColor: placementCoordColors?.bg ?? "rgba(20, 20, 20, 0.9)",
                border: `1px solid ${placementCoordColors?.border ?? "rgba(255, 255, 255, 0.12)"}`,
                borderRadius: 4,
                padding: "4px 8px",
                fontFamily: "monospace",
                fontSize: 11,
                color: placementCoordColors?.text ?? "rgb(245, 245, 245)",
                textAlign: "center",
              }}
            >
              {viewState.latitude.toFixed(6)}, {viewState.longitude.toFixed(6)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
