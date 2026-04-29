import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Share } from "react-native";

import { toast } from "./sonner";

export type AwareUrlParams = {
  entityId?: string;
  tab?: string;
  lat?: string;
  lng?: string;
  alt?: string;
  zoom?: string;
  layout?: string;
};

export const ENTITY_NAV_PARAMS: (keyof AwareUrlParams)[] = [
  "entityId",
  "lat",
  "lng",
  "alt",
  "zoom",
  "tab",
];

export function useUrlParams() {
  const router = useRouter();
  const params = useLocalSearchParams<AwareUrlParams>();

  const updateParams = (updates: Partial<AwareUrlParams>) => {
    const newParams: Record<string, string | string[] | undefined> = { ...params };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        newParams[key] = undefined;
      } else {
        newParams[key] = value;
      }
    }
    router.setParams(newParams);
  };

  const clearParams = (keys: (keyof AwareUrlParams)[]) => {
    const newParams: Record<string, string | string[] | undefined> = { ...params };
    for (const key of keys) {
      newParams[key] = undefined;
    }
    router.setParams(newParams);
  };

  return { params, updateParams, clearParams };
}

export function getShareableEntityUrl(
  entityId: string,
  options?: { tab?: string; zoom?: number; lat?: number; lng?: number },
): string {
  const tabParam = options?.tab ? `&tab=${encodeURIComponent(options.tab)}` : "";
  const zoomParam =
    options?.zoom !== undefined ? `&zoom=${Math.round(options.zoom * 10) / 10}` : "";
  const latParam =
    options?.lat !== undefined ? `&lat=${Math.round(options.lat * 100000) / 100000}` : "";
  const lngParam =
    options?.lng !== undefined ? `&lng=${Math.round(options.lng * 100000) / 100000}` : "";

  if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}/aware?entityId=${encodeURIComponent(entityId)}${tabParam}${zoomParam}${latParam}${lngParam}`;
  }

  const scheme = Constants.expoConfig?.extra?.SCHEME ?? "hydris";
  return `${scheme}://aware?entityId=${encodeURIComponent(entityId)}${tabParam}${zoomParam}${latParam}${lngParam}`;
}

export function getShareableLocationUrl(
  lat: number,
  lng: number,
  options?: { alt?: number; zoom?: number },
): string {
  const altParam = options?.alt !== undefined ? `&alt=${Math.round(options.alt)}` : "";
  const zoomParam =
    options?.zoom !== undefined ? `&zoom=${Math.round(options.zoom * 10) / 10}` : "";

  // Round coordinates to 5 decimal places (~1m precision)
  const latRounded = Math.round(lat * 100000) / 100000;
  const lngRounded = Math.round(lng * 100000) / 100000;

  if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}/aware?lat=${latRounded}&lng=${lngRounded}${altParam}${zoomParam}`;
  }

  const scheme = Constants.expoConfig?.extra?.SCHEME ?? "hydris";
  return `${scheme}://aware?lat=${latRounded}&lng=${lngRounded}${altParam}${zoomParam}`;
}

export async function copyShareableLink(url: string) {
  if (process.env.EXPO_OS === "web") {
    await Clipboard.setStringAsync(url);
    toast.success("Link copied to clipboard");
  } else {
    await Share.share({ url });
  }
}

export type ViewStatePayload = {
  /** preset id */
  p: string;
  /** layout tree */
  t?: unknown;
  /** overlay diffs from defaults */
  o?: Record<string, Record<string, boolean>>;
  /** map layer */
  l?: string;
  /** entity list mode: "tracks" | "assets" */
  list?: string;
  /** detail panel tab: "overview" | "info" | "location" | "components" */
  tab?: string;
};

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(encoded: string): string {
  let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return atob(b64);
}

function encodeViewState(payload: ViewStatePayload): string {
  return base64urlEncode(JSON.stringify(payload));
}

export function decodeViewState(encoded: string): ViewStatePayload | null {
  try {
    const json = base64urlDecode(encoded);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || typeof parsed.p !== "string") return null;
    return parsed as ViewStatePayload;
  } catch {
    return null;
  }
}

function getShareableViewUrl(baseUrl: string, viewState: string): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}layout=${viewState}`;
}

type OverlayData = Record<string, Record<string, boolean>>;

export type BuildShareViewUrlDeps = {
  getSelectedEntityId: () => string | null;
  getMapView: () => { lat: number; lng: number; zoom: number } | null;
  getTab: () => string | undefined;
  getLayoutSnapshot: () => { activePresetId: string; tree: unknown };
  getOverlayState: () => OverlayData;
  getDefaultOverlays: () => OverlayData;
  getLayer: () => string;
  getListMode: () => string;
  getDetailTab: () => string;
};

export function buildShareViewUrl(deps: BuildShareViewUrlDeps): string | null {
  const view = deps.getMapView();
  if (!view) return null;

  const selectedEntityId = deps.getSelectedEntityId();
  const tab = deps.getTab();

  const baseUrl = selectedEntityId
    ? getShareableEntityUrl(selectedEntityId, {
        tab,
        zoom: view.zoom,
        lat: view.lat,
        lng: view.lng,
      })
    : getShareableLocationUrl(view.lat, view.lng, { zoom: view.zoom });

  const snap = deps.getLayoutSnapshot();
  const payload: ViewStatePayload = { p: snap.activePresetId, t: snap.tree };

  const overlayState = deps.getOverlayState();
  const defaultOverlays = deps.getDefaultOverlays();
  const overlayDiff: Record<string, Record<string, boolean>> = {};
  for (const cat of Object.keys(defaultOverlays)) {
    const defaults = defaultOverlays[cat]!;
    const current = overlayState[cat]!;
    const diff: Record<string, boolean> = {};
    let hasDiff = false;
    for (const key of Object.keys(defaults)) {
      if (current[key] !== defaults[key]) {
        diff[key] = current[key]!;
        hasDiff = true;
      }
    }
    if (hasDiff) overlayDiff[cat] = diff;
  }
  if (Object.keys(overlayDiff).length > 0) {
    payload.o = overlayDiff;
  }

  const layer = deps.getLayer();
  if (layer !== "satellite") {
    payload.l = layer;
  }

  const listMode = deps.getListMode();
  if (listMode !== "tracks") {
    payload.list = listMode;
  }

  if (selectedEntityId) {
    const detailTab = deps.getDetailTab();
    if (detailTab !== "overview") {
      payload.tab = detailTab;
    }
  }

  const viewState = encodeViewState(payload);
  return getShareableViewUrl(baseUrl, viewState);
}
