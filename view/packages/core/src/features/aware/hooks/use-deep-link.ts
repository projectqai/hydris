import { validateLayoutNode } from "@hydris/ui/layout/tree-utils";
import type { LayoutNode } from "@hydris/ui/layout/types";
import { useEffect, useRef } from "react";
import { toast } from "sonner-native";

import { type AwareUrlParams, decodeViewState, useUrlParams } from "../../../lib/use-url-params";
import { COMPONENT_REGISTRY } from "../constants";
import { useEntityStore } from "../store/entity-store";
import { useLeftPanelStore } from "../store/left-panel-store";
import { mapEngineActions } from "../store/map-engine-store";
import { useMapStore } from "../store/map-store";
import { DEFAULT_OVERLAYS, useOverlayStore } from "../store/overlay-store";
import { useSelectionStore } from "../store/selection-store";
import { useTabStore } from "../store/tab-store";

const VALID_COMPONENT_IDS = new Set(Object.keys(COMPONENT_REGISTRY));

function getParamsKey(params: AwareUrlParams): string {
  const { entityId, lat, lng, alt, zoom, tab } = params;
  return `${entityId ?? ""}-${lat ?? ""}-${lng ?? ""}-${alt ?? ""}-${zoom ?? ""}-${tab ?? ""}`;
}

type ValidationResult = {
  isValid: boolean;
  error?: string;
};

function validateParams(params: AwareUrlParams): ValidationResult {
  const { entityId, lat, lng, alt, zoom } = params;

  const hasPartialCoords = (lat && !lng) || (!lat && lng);
  if (hasPartialCoords) return { isValid: false, error: "Both lat and lng are required" };

  if (lat && lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) return { isValid: false, error: "Invalid coordinates" };
    if (latNum < -90 || latNum > 90)
      return { isValid: false, error: "Latitude must be between -90 and 90" };
    if (lngNum < -180 || lngNum > 180)
      return { isValid: false, error: "Longitude must be between -180 and 180" };
    if (alt && isNaN(parseFloat(alt))) return { isValid: false, error: "Invalid altitude" };
  }

  if (zoom) {
    const zoomNum = parseFloat(zoom);
    if (isNaN(zoomNum) || zoomNum < 0 || zoomNum > 22)
      return { isValid: false, error: "Zoom must be between 0 and 22" };
  }

  if (entityId !== undefined && entityId.trim() === "")
    return { isValid: false, error: "Entity ID cannot be empty" };

  return { isValid: true };
}

type DeepLinkOptions = {
  applyExternalLayout: (presetId: string, tree?: LayoutNode) => void;
};

export function useDeepLink(mapReady: boolean, options: DeepLinkOptions) {
  const { params, clearParams } = useUrlParams();
  const processedKeyRef = useRef<string | null>(null);
  const positionAppliedRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const layoutProcessedRef = useRef(false);
  const entities = useEntityStore((s) => s.entities);
  const isConnected = useEntityStore((s) => s.isConnected);
  const fetchEntity = useEntityStore((s) => s.fetchEntity);

  useEffect(() => {
    if (!mapReady) return;

    const { entityId, lat, lng, alt, zoom, tab, layout } = params;

    if (layout && !layoutProcessedRef.current) {
      layoutProcessedRef.current = true;
      const payload = decodeViewState(layout);
      if (payload) {
        const validatedTree = payload.t
          ? validateLayoutNode(payload.t, VALID_COMPONENT_IDS)
          : undefined;
        optionsRef.current.applyExternalLayout(payload.p, validatedTree ?? undefined);

        if (payload.o) {
          const merged: Record<string, Record<string, boolean>> = {};
          for (const cat of Object.keys(DEFAULT_OVERLAYS) as (keyof typeof DEFAULT_OVERLAYS)[]) {
            merged[cat] = { ...DEFAULT_OVERLAYS[cat], ...payload.o[cat] };
          }
          useOverlayStore.setState(merged);
        }

        if (payload.l) {
          useMapStore.getState().setLayer(payload.l as "dark" | "satellite" | "street");
        }

        if (payload.list === "assets" || payload.list === "tracks") {
          useLeftPanelStore.setState({ listMode: payload.list });
        }

        if (payload.tab) {
          useTabStore.setState({ initialTab: payload.tab });
        }
      }
      requestAnimationFrame(() => clearParams(["layout"]));
    }

    const hasDeepLinkParams = entityId !== undefined || lat || lng;
    if (!hasDeepLinkParams) return;

    const paramsKey = getParamsKey(params);
    if (processedKeyRef.current === paramsKey) return;

    const validation = validateParams(params);
    if (!validation.isValid) {
      if (validation.error) {
        toast.error(validation.error);
      }
      clearParams(["lat", "lng", "alt", "zoom"]);
      return;
    }

    // Fly to position immediately — don't wait for entity loading
    const targetZoom = zoom ? parseFloat(zoom) : undefined;
    if (lat && lng && positionAppliedRef.current !== paramsKey) {
      positionAppliedRef.current = paramsKey;
      mapEngineActions.flyTo(
        parseFloat(lat),
        parseFloat(lng),
        alt ? parseFloat(alt) : undefined,
        undefined,
        targetZoom,
      );
      if (!entityId) {
        useSelectionStore.getState().select(null);
      }
    }

    // Entity selection happens async — may still be loading
    if (entityId) {
      if (!isConnected) return;
      handleEntityDeepLink(entityId, { tab, lat, lng, alt, zoom: targetZoom });
    }

    // Mark fully processed only when all parts are handled
    processedKeyRef.current = paramsKey;

    async function handleEntityDeepLink(
      id: string,
      opts: { tab?: string; lat?: string; lng?: string; alt?: string; zoom?: number },
    ) {
      let entity = entities.get(id);

      if (!entity) {
        const fetched = await fetchEntity(id);
        entity = fetched ?? undefined;
      }

      if (entity) {
        if (opts.tab) {
          useTabStore.setState({ initialTab: opts.tab });
        }
        useSelectionStore.getState().select(id);
        // Only fly to entity geo if no explicit position was shared
        if (!opts.lat && !opts.lng && entity.geo) {
          mapEngineActions.flyTo(
            entity.geo.latitude,
            entity.geo.longitude,
            entity.geo.altitude ?? undefined,
            undefined,
            opts.zoom ?? 14,
          );
        }
      } else {
        toast.error("Entity not found");
      }
    }
  }, [mapReady, isConnected, params, entities, fetchEntity, clearParams]);
}
