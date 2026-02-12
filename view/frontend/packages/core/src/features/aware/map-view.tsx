"use dom";

import type { MapActions } from "@hydris/map-engine/adapters/maplibre";
import { MapView as MapAdapter } from "@hydris/map-engine/adapters/maplibre";
import type { BaseLayer, EntityFilter } from "@hydris/map-engine/types";
import type { EntityData } from "@hydris/map-engine/types";
import type { DOMProps } from "expo/dom";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef, useState } from "react";

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
  ) => void;
}

type FlyToTarget = string | null;
type ZoomCommand = string | null;

type MapViewProps = {
  ref: Ref<MapViewRef>;
  filterJson?: string;
  flyToTarget?: FlyToTarget;
  zoomCommand?: ZoomCommand;
  baseLayer?: BaseLayer;
  coverageVisible?: boolean;
  shapesVisible?: boolean;
  onReady?: () => Promise<void>;
  onEntityClick?: (id: string | null) => Promise<void>;
  onTrackingLost?: () => Promise<void>;
  onViewChange?: (lat: number, lng: number, zoom: number) => Promise<void>;
  dom?: DOMProps;
};

export default function MapView({
  ref,
  filterJson,
  flyToTarget,
  zoomCommand,
  baseLayer = "dark",
  coverageVisible = false,
  shapesVisible = true,
  onReady,
  onEntityClick,
  onTrackingLost,
  onViewChange,
}: MapViewProps) {
  const mapActionsRef = useRef<MapActions | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const lastFlyToCommandRef = useRef<string | null>(null);
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
  const [pushedBaseLayer, setPushedBaseLayer] = useState<BaseLayer>(baseLayer);
  const [pushedFilterJson, setPushedFilterJson] = useState<string>(filterJson ?? "");
  const [pushedCoverageVisible, setPushedCoverageVisible] = useState(coverageVisible);
  const [pushedShapesVisible, setPushedShapesVisible] = useState(shapesVisible);

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
    tracks: { blue: true, red: true, neutral: true, unknown: true },
    sensors: {},
  };

  const flushRender = () => {
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

  const lastChange = { version: entityVersion, geoChanged, updatedIds };

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
        ) => {
          setPushedBaseLayer(baseLayer as BaseLayer);
          setPushedFilterJson(filterJson);
          setPushedCoverageVisible(coverageVisible);
          setPushedShapesVisible(shapesVisible);
        },
      }) as DOMImperativeFactory,
    [],
  );

  useEffect(() => {
    if (!flyToTarget || !actionsReady || !mapActionsRef.current) return;
    if (flyToTarget === lastFlyToCommandRef.current) return;

    lastFlyToCommandRef.current = flyToTarget;
    const parts = flyToTarget.split(",");
    const lat = parseFloat(parts[0] ?? "0");
    const lng = parseFloat(parts[1] ?? "0");
    const duration = parts[3] ? parseFloat(parts[3]) : 1.5;
    const zoom = parts[4] ? parseFloat(parts[4]) : undefined;

    mapActionsRef.current.flyTo({ lat, lng }, { duration, zoom });
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

  const baseStyles = `
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background-color: #161616;
    }
  `;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#161616",
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
        coverageVisible={pushedCoverageVisible}
        shapesVisible={pushedShapesVisible}
        onEntityClick={async (id) => await onEntityClick?.(id)}
        onReady={async () => await onReady?.()}
        onTrackingLost={async () => await onTrackingLost?.()}
        onViewChange={async (lat, lng, zoom) => await onViewChange?.(lat, lng, zoom)}
        onActionsReady={handleActionsReady}
      />
    </div>
  );
}
