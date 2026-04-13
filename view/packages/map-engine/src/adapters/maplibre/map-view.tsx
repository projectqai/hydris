import "maplibre-gl/dist/maplibre-gl.css";
import "./overrides.css";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
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
  ShapeFeature,
  ShapeProperties,
} from "../../types";
import { shapeToFeatures } from "../../utils/shape-to-geojson";
import { isShapeVisible, type ShapeVisibilityContext } from "../../utils/shape-visibility";

const SECTOR_MIN_ZOOM = 12;

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
};

function DeckGLOverlay({ layers, pickingRadius, onClick, onHover }: DeckGLOverlayProps) {
  const overlay = useControl(
    () => new MapboxOverlay({ layers, pickingRadius, onClick, onHover, useDevicePixels: 2 }),
  );
  overlay.setProps({ layers, pickingRadius, onClick, onHover });
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

const DEFAULT_FILTER: EntityFilter = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: {},
};

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
  baseLayer?: BaseLayer;
  colorScheme?: "dark" | "light";
  initialView?: { lat: number; lng: number; zoom: number };
  coverageVisible?: boolean;
  shapesVisible?: boolean;
  detectionsVisible?: boolean;
  trackHistoryVisible?: boolean;
  rangeRingCenter?: GeoPosition | null;
  rangeRingsActive?: boolean;
  onEntityClick?: (id: string | null) => void | Promise<void>;
  onMapClick?: (lat: number, lng: number) => void | Promise<void>;
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
  rangeRingCenter = null,
  rangeRingsActive = false,
  onEntityClick,
  onMapClick,
  onReady,
  onActionsReady,
  onTrackingLost,
  onViewChange,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
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

  useEffect(() => {
    document.fonts.load("16px Inter").then(() => setFontLoaded(true));
  }, []);

  // Update debounce timer when selection changes from outside (e.g., left panel)
  useEffect(() => {
    if (selectedId) {
      lastLayerClickTimeRef.current = Date.now();
    }
  }, [selectedId]);

  const handleMapLoad = () => {
    onReady?.();

    if (actionsReadyCalledRef.current) return;
    actionsReadyCalledRef.current = true;

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
      if (trackedEntity) {
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
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: Math.min(expansionZoom + 1, 20),
      speed: 1.2,
    });
  };

  const {
    layers: clusterLayers,
    selectionData,
    labelData,
    coverageEntities,
  } = useEntityClusters({
    entityMap,
    lastChange,
    filter,
    selectedId,
    shapesVisible,
    detectionsVisible,
    zoom: viewState.zoom,
    pickable: !rangeRingsActive,
    onEntityClick: handleEntityClick,
    onClusterClick: handleClusterClick,
  });

  const coverageShapeIds = new Set<string>();
  for (const entity of entityMap.values()) {
    if (entity.coverageEntityIds) {
      for (const covId of entity.coverageEntityIds) coverageShapeIds.add(covId);
    }
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
      baseLayer,
    });
  }

  const layers: Layer[] = [
    createCoverageLayer({
      data: coverageFeatures,
      visible: coverageVisible || coverageFeatures.length > 0,
      baseLayer,
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
      baseLayer,
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

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", zIndex: 0 }}>
      <MapGL
        ref={mapRef}
        mapStyle={STYLES[baseLayer]}
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
        />
        <ScaleControl position="bottom-right" maxWidth={100} unit="metric" />
      </MapGL>
    </div>
  );
}
