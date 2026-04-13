import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toast } from "sonner-native";

export type AwareUrlParams = {
  entityId?: string;
  tab?: string;
  lat?: string;
  lng?: string;
  alt?: string;
  zoom?: string;
  heading?: string;
  pitch?: string;
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
  await Clipboard.setStringAsync(url);
  toast("Link copied to clipboard");
}

export type ViewStatePayload = {
  /** preset id */
  p: string;
  /** layout tree (only if modified from preset default) */
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

export function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(encoded: string): string {
  let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return atob(b64);
}

export function encodeViewState(payload: ViewStatePayload): string {
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

export function getShareableViewUrl(baseUrl: string, viewState: string): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}layout=${viewState}`;
}
