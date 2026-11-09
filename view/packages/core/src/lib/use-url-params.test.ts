import { describe, expect, it, vi } from "vitest";

vi.mock("expo-clipboard", () => ({}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { SCHEME: "hydris" } } },
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: vi.fn(),
  useRouter: vi.fn(),
}));
vi.mock("react-native", () => ({ Share: { share: vi.fn() } }));
vi.mock("./sonner", () => ({ toast: { success: vi.fn() } }));

import { buildShareViewUrl, type BuildShareViewUrlDeps } from "./use-url-params";

const deps: BuildShareViewUrlDeps = {
  getSelectedEntityId: () => null,
  getMapView: () => ({ lat: 1, lng: 2, zoom: 3 }),
  getTab: () => undefined,
  getLayoutSnapshot: () => ({ activePresetId: "preset-1", tree: { type: "pane" } }),
  getOverlayState: () => ({}),
  getDefaultOverlays: () => ({}),
  getHiddenLayers: () => ({}),
  getLayerOpacity: () => ({}),
  getLayer: () => "satellite",
  getListMode: () => "tracks",
  getDetailTab: () => "overview",
};

describe("buildShareViewUrl", () => {
  it("encodes a default view to a byte-identical URL", () => {
    expect(buildShareViewUrl(deps)).toBe(
      "hydris://aware?lat=1&lng=2&zoom=3&layout=eyJwIjoicHJlc2V0LTEiLCJ0Ijp7InR5cGUiOiJwYW5lIn19",
    );
  });
});
