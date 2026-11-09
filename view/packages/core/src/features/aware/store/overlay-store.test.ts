import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OVERLAYS, useOverlayStore } from "./overlay-store";

// the store now persists via AsyncStorage, which has no native module under the
// node test env. stub it so persist writes are no-ops.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));

describe("overlay toggle isolation", () => {
  beforeEach(() => {
    useOverlayStore.setState({ ...DEFAULT_OVERLAYS });
  });

  it("toggling one track affiliation does not affect others", () => {
    useOverlayStore.getState().toggle("tracks", "blue");

    const { tracks } = useOverlayStore.getState();
    expect(tracks.blue).toBe(false);
    expect(tracks.red).toBe(true);
    expect(tracks.neutral).toBe(true);
    expect(tracks.unknown).toBe(true);
    expect(tracks.unclassified).toBe(true);
  });

  it("toggling visualization does not affect tracks or sensors", () => {
    useOverlayStore.getState().toggle("visualization", "detections");

    const state = useOverlayStore.getState();
    expect(state.visualization.detections).toBe(true);
    expect(state.tracks).toEqual(DEFAULT_OVERLAYS.tracks);
    expect(state.sensors).toEqual(DEFAULT_OVERLAYS.sensors);
  });

  it("double toggle restores original state", () => {
    const { toggle } = useOverlayStore.getState();
    toggle("tracks", "red");
    toggle("tracks", "red");

    expect(useOverlayStore.getState().tracks.red).toBe(true);
  });
});
