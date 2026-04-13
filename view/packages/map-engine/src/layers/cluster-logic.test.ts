import { beforeEach, describe, expect, it } from "vitest";

import type { Affiliation } from "../types";
import {
  AFFILIATION_CODE,
  createClusterEngine,
  type FilterInput,
  type PackedEntities,
} from "./cluster-logic";

function packEntities(
  entities: {
    id: string;
    lat: number;
    lng: number;
    affiliation: Affiliation;
    symbol?: string | null;
    hasShape?: boolean;
    isDetection?: boolean;
  }[],
): PackedEntities {
  const count = entities.length;
  const positions = new Float64Array(count * 2);
  const affiliations = new Uint8Array(count);
  const ids: string[] = [];
  const symbols: (string | null)[] = [];
  const hasShape = new Uint8Array(count);
  const isDetection = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const e = entities[i]!;
    positions[i * 2] = e.lat;
    positions[i * 2 + 1] = e.lng;
    affiliations[i] = AFFILIATION_CODE[e.affiliation];
    ids.push(e.id);
    symbols.push(e.symbol === null ? null : (e.symbol ?? "SFGPU------"));
    hasShape[i] = e.hasShape ? 1 : 0;
    isDetection[i] = e.isDetection ? 1 : 0;
  }

  return { positions, affiliations, ids, symbols, hasShape, isDetection, count };
}

const ALL_ON: FilterInput = {
  blue: true,
  red: true,
  neutral: true,
  unknown: true,
  unclassified: true,
  shapesVisible: true,
  detectionsVisible: true,
};

function filterWith(overrides: Partial<FilterInput>): FilterInput {
  return { ...ALL_ON, ...overrides };
}

// Spread entities geographically so they don't cluster
function makeEntity(
  id: string,
  affiliation: Affiliation,
  index: number,
  opts?: { hasShape?: boolean; isDetection?: boolean; symbol?: string | null },
) {
  return { id, lat: 10 + index * 10, lng: 10 + index * 10, affiliation, ...opts };
}

function visibleEntityIds(
  engine: ReturnType<typeof createClusterEngine>,
  packed: PackedEntities,
  filter: FilterInput,
  zoom = 5,
) {
  return engine
    .process(packed, filter, zoom, true)
    .filter((r) => !r.isCluster)
    .map((r) => r.entityId);
}

describe("entity visibility filtering", () => {
  let engine: ReturnType<typeof createClusterEngine>;
  beforeEach(() => {
    engine = createClusterEngine();
  });

  describe("affiliation toggles", () => {
    const packed = packEntities([
      makeEntity("blue-1", "blue", 0),
      makeEntity("red-1", "red", 1),
      makeEntity("neutral-1", "neutral", 2),
      makeEntity("unknown-1", "unknown", 3),
    ]);

    it("toggling off an affiliation hides only those entities", () => {
      const ids = visibleEntityIds(engine, packed, filterWith({ blue: false }));
      expect(ids).not.toContain("blue-1");
      expect(ids).toContain("red-1");
      expect(ids).toContain("neutral-1");
      expect(ids).toContain("unknown-1");
    });

    it("toggling off multiple affiliations hides all of them", () => {
      const ids = visibleEntityIds(engine, packed, filterWith({ blue: false, red: false }));
      expect(ids).not.toContain("blue-1");
      expect(ids).not.toContain("red-1");
      expect(ids).toHaveLength(2);
    });
  });

  describe("shape vs detection visibility", () => {
    const packed = packEntities([
      makeEntity("track", "blue", 0),
      makeEntity("geoshape", "blue", 1, { hasShape: true }),
      makeEntity("detection-shape", "red", 2, { hasShape: true, isDetection: true }),
    ]);

    it("shapesVisible=false hides shapes but not detection shapes", () => {
      const ids = visibleEntityIds(engine, packed, filterWith({ shapesVisible: false }));
      expect(ids).toContain("track");
      expect(ids).not.toContain("geoshape");
      expect(ids).toContain("detection-shape");
    });

    it("detectionsVisible=false hides detection shapes but not plain shapes", () => {
      const ids = visibleEntityIds(engine, packed, filterWith({ detectionsVisible: false }));
      expect(ids).toContain("track");
      expect(ids).toContain("geoshape");
      expect(ids).not.toContain("detection-shape");
    });
  });

  describe("radar tracks: isDetection without hasShape", () => {
    // Radar tracks have detection component but render as point entities, not shapes.
    // They must NOT be hidden by the detections toggle.
    const packed = packEntities([
      makeEntity("radar-track-1", "unknown", 0, { isDetection: true }),
      makeEntity("radar-track-2", "unknown", 1, { isDetection: true }),
      makeEntity("radar-sensor", "blue", 2),
    ]);

    it("radar tracks stay visible when detectionsVisible=false", () => {
      const ids = visibleEntityIds(engine, packed, filterWith({ detectionsVisible: false }));
      expect(ids).toContain("radar-track-1");
      expect(ids).toContain("radar-track-2");
      expect(ids).toContain("radar-sensor");
    });

    it("radar tracks are hidden only by their affiliation toggle", () => {
      const ids = visibleEntityIds(engine, packed, filterWith({ unknown: false }));
      expect(ids).not.toContain("radar-track-1");
      expect(ids).not.toContain("radar-track-2");
      expect(ids).toContain("radar-sensor");
    });
  });

  describe("entities without symbols are excluded", () => {
    it("null symbol entities never appear in results", () => {
      const packed = packEntities([
        makeEntity("no-sym", "blue", 0, { symbol: null }),
        makeEntity("has-sym", "blue", 1),
      ]);
      const ids = visibleEntityIds(engine, packed, ALL_ON);
      expect(ids).not.toContain("no-sym");
      expect(ids).toContain("has-sym");
    });
  });

  describe("filter consistency across zoom levels", () => {
    // Filter logic is duplicated across 3 branches based on zoom:
    //   zoom < 10  → "all" index
    //   zoom 10-12 → "affiliation" index
    //   zoom >= 13 → "symbol" index
    // All branches must produce identical filtering results.
    const packed = packEntities([
      makeEntity("blue-1", "blue", 0),
      makeEntity("red-1", "red", 1),
      makeEntity("shape-1", "blue", 2, { hasShape: true }),
      makeEntity("detection-1", "red", 3, { hasShape: true, isDetection: true }),
    ]);

    const filter = filterWith({ red: false, shapesVisible: false });

    for (const zoom of [5, 11, 14]) {
      it(`zoom ${zoom}: same filtering regardless of index strategy`, () => {
        const eng = createClusterEngine();
        const ids = visibleEntityIds(eng, packed, filter, zoom);

        expect(ids).toContain("blue-1");
        expect(ids).not.toContain("red-1");
        expect(ids).not.toContain("shape-1");
        expect(ids).not.toContain("detection-1");
      });
    }
  });

  describe("filter updates without geo changes", () => {
    const packed = packEntities([makeEntity("blue-1", "blue", 0), makeEntity("red-1", "red", 1)]);

    it("toggling a filter off then on restores the entity", () => {
      engine.process(packed, ALL_ON, 5, true);
      engine.process(packed, filterWith({ blue: false }), 5, false);
      const restored = engine
        .process(packed, ALL_ON, 5, false)
        .filter((r) => !r.isCluster)
        .map((r) => r.entityId);
      expect(restored).toContain("blue-1");
      expect(restored).toContain("red-1");
    });
  });
});
