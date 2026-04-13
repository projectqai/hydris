import { describe, expect, it } from "vitest";

import type { EntityData, EntityFilter } from "../types";
import { isShapeVisible, type ShapeVisibilityContext } from "./shape-visibility";

const ALL_TRACKS_ON: EntityFilter = {
  tracks: { blue: true, red: true, neutral: true, unknown: true, unclassified: true },
  sensors: {},
};

function makeCtx(overrides?: Partial<ShapeVisibilityContext>): ShapeVisibilityContext {
  return {
    coverageShapeIds: new Set(),
    filter: ALL_TRACKS_ON,
    selectedId: null,
    selectedTrackShapeIds: new Set(),
    entityMap: new Map(),
    detectionsVisible: true,
    trackHistoryVisible: false,
    shapesVisible: true,
    ...overrides,
  };
}

function makeEntity(id: string, opts?: Partial<EntityData>): EntityData {
  return {
    id,
    position: { lat: 0, lng: 0 },
    affiliation: "blue",
    ...opts,
  };
}

describe("isShapeVisible", () => {
  it("coverage shapes are always hidden", () => {
    const ctx = makeCtx({ coverageShapeIds: new Set(["cov-1"]) });
    expect(isShapeVisible("cov-1", "blue", ctx)).toBe(false);
  });

  it("shapes filtered by affiliation toggle", () => {
    const filter: EntityFilter = {
      ...ALL_TRACKS_ON,
      tracks: { ...ALL_TRACKS_ON.tracks, red: false },
    };
    const redEntity = makeEntity("red-shape", { label: "Geofence", affiliation: "red" });
    const blueEntity = makeEntity("blue-shape", { label: "Geofence", affiliation: "blue" });
    const ctx = makeCtx({
      filter,
      entityMap: new Map([
        ["red-shape", redEntity],
        ["blue-shape", blueEntity],
      ]),
    });
    expect(isShapeVisible("red-shape", "red", ctx)).toBe(false);
    expect(isShapeVisible("blue-shape", "blue", ctx)).toBe(true);
  });

  it("selected entity shape is visible when its affiliation is enabled", () => {
    const entity = makeEntity("shape-1", { label: "Geofence", affiliation: "blue" });
    const ctx = makeCtx({
      selectedId: "shape-1",
      entityMap: new Map([["shape-1", entity]]),
      shapesVisible: false,
    });
    expect(isShapeVisible("shape-1", "blue", ctx)).toBe(true);
  });

  it("selected entity shape is hidden when its affiliation is disabled", () => {
    const filter: EntityFilter = {
      ...ALL_TRACKS_ON,
      tracks: { ...ALL_TRACKS_ON.tracks, red: false },
    };
    const entity = makeEntity("shape-1", { label: "Geofence", affiliation: "red" });
    const ctx = makeCtx({
      filter,
      selectedId: "shape-1",
      entityMap: new Map([["shape-1", entity]]),
    });
    expect(isShapeVisible("shape-1", "red", ctx)).toBe(false);
  });

  describe("detection shapes", () => {
    it("visible when detectionsVisible=true", () => {
      const entity = makeEntity("det-1", { isDetection: true, label: "drone" });
      const ctx = makeCtx({
        entityMap: new Map([["det-1", entity]]),
        detectionsVisible: true,
      });
      expect(isShapeVisible("det-1", "blue", ctx)).toBe(true);
    });

    it("hidden when detectionsVisible=false", () => {
      const entity = makeEntity("det-1", { isDetection: true, label: "drone" });
      const ctx = makeCtx({
        entityMap: new Map([["det-1", entity]]),
        detectionsVisible: false,
      });
      expect(isShapeVisible("det-1", "blue", ctx)).toBe(false);
    });

    it("isDetection takes precedence over shapesVisible", () => {
      const entity = makeEntity("det-1", { isDetection: true, label: "drone" });
      const ctx = makeCtx({
        entityMap: new Map([["det-1", entity]]),
        detectionsVisible: false,
        shapesVisible: true,
      });
      expect(isShapeVisible("det-1", "blue", ctx)).toBe(false);
    });
  });

  describe("track history/prediction shapes (no label)", () => {
    it("hidden by default when trackHistoryVisible=false", () => {
      const entity = makeEntity("hist-1", { label: undefined });
      const ctx = makeCtx({
        entityMap: new Map([["hist-1", entity]]),
        trackHistoryVisible: false,
      });
      expect(isShapeVisible("hist-1", "blue", ctx)).toBe(false);
    });

    it("visible when trackHistoryVisible=true", () => {
      const entity = makeEntity("hist-1", { label: undefined });
      const ctx = makeCtx({
        entityMap: new Map([["hist-1", entity]]),
        trackHistoryVisible: true,
      });
      expect(isShapeVisible("hist-1", "blue", ctx)).toBe(true);
    });

    it("visible when selected track history regardless of toggle", () => {
      const entity = makeEntity("hist-1", { label: undefined });
      const ctx = makeCtx({
        entityMap: new Map([["hist-1", entity]]),
        trackHistoryVisible: false,
        selectedTrackShapeIds: new Set(["hist-1"]),
      });
      expect(isShapeVisible("hist-1", "blue", ctx)).toBe(true);
    });
  });

  describe("labeled geoshapes", () => {
    it("visible when shapesVisible=true", () => {
      const entity = makeEntity("shape-1", { label: "Geofence A" });
      const ctx = makeCtx({
        entityMap: new Map([["shape-1", entity]]),
        shapesVisible: true,
      });
      expect(isShapeVisible("shape-1", "blue", ctx)).toBe(true);
    });

    it("hidden when shapesVisible=false", () => {
      const entity = makeEntity("shape-1", { label: "Geofence A" });
      const ctx = makeCtx({
        entityMap: new Map([["shape-1", entity]]),
        shapesVisible: false,
      });
      expect(isShapeVisible("shape-1", "blue", ctx)).toBe(false);
    });
  });

  describe("orphaned shapes (entity not in map)", () => {
    it("treated as track history (requires trackHistoryVisible)", () => {
      const ctx = makeCtx({ trackHistoryVisible: false });
      expect(isShapeVisible("orphan-1", "blue", ctx)).toBe(false);
    });

    it("visible when trackHistoryVisible=true", () => {
      const ctx = makeCtx({ trackHistoryVisible: true });
      expect(isShapeVisible("orphan-1", "blue", ctx)).toBe(true);
    });
  });
});
