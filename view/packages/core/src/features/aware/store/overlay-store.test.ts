import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_OVERLAYS, useOverlayStore } from "./overlay-store";

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

  it("toggling across multiple categories is independent", () => {
    const { toggle } = useOverlayStore.getState();
    toggle("tracks", "blue");
    toggle("visualization", "detections");
    toggle("sensors", "degraded");

    const state = useOverlayStore.getState();
    expect(state.tracks.blue).toBe(false);
    expect(state.tracks.red).toBe(true);
    expect(state.visualization.detections).toBe(true);
    expect(state.visualization.shapes).toBe(true);
    expect(state.sensors.degraded).toBe(false);
    expect(state.sensors.online).toBe(true);
  });

  it("double toggle restores original state", () => {
    const { toggle } = useOverlayStore.getState();
    toggle("tracks", "red");
    toggle("tracks", "red");

    expect(useOverlayStore.getState().tracks.red).toBe(true);
  });
});
