import ms from "milsymbol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSymbolAtlas } from "./symbol-atlas";

const ICON_SIZE = 32;

const AFFILIATIONS = ["F", "H", "N", "U", "A", "S"];
const DIMENSIONS = ["A", "G", "S", "U", "P", "F"];
const STATUSES = ["P", "A"];
const MODIFIERS = ["--", "A-"];

function frameMatrix(): string[] {
  const sidcs: string[] = [];
  for (const aff of AFFILIATIONS) {
    for (const dim of DIMENSIONS) {
      for (const status of STATUSES) {
        for (const mod of MODIFIERS) {
          sidcs.push(`S${aff}${dim}${status}------${mod}---`);
        }
      }
    }
  }
  return sidcs;
}

function installDomStub() {
  const ctx = { clearRect() {}, drawImage() {}, getImageData: () => ({ data: [] }) };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {}
    },
  );
}

describe("symbol atlas anchoring", () => {
  beforeEach(installDomStub);
  afterEach(() => vi.unstubAllGlobals());

  it("anchors every atlas symbol at milsymbol's true point", () => {
    const atlas = getSymbolAtlas(ICON_SIZE);
    const sidcs = frameMatrix();
    expect(sidcs.length).toBeGreaterThan(100);

    const keys = sidcs.map((sidc) => [sidc, atlas.getOrCreate(sidc, ICON_SIZE)] as const);
    const mapping = atlas.getMapping();
    for (const [sidc, key] of keys) {
      const entry = mapping[key];
      expect(entry, sidc).toBeDefined();
      if (!entry) continue;
      const truth = new ms.Symbol(sidc, { size: ICON_SIZE }).getAnchor();
      expect(entry.anchorX).toBeCloseTo(truth.x, 5);
      expect(entry.anchorY).toBeCloseTo(truth.y, 5);
    }
  });

  it("does not fall back to the bbox center for off-center frames", () => {
    const atlas = getSymbolAtlas(ICON_SIZE);
    for (const sidc of ["SFAP-----------", "SFUP-----------", "SFGPUCI---A----"]) {
      const key = atlas.getOrCreate(sidc, ICON_SIZE);
      const e = atlas.getMapping()[key];
      expect(e, sidc).toBeDefined();
      if (!e) continue;
      const offCenter =
        Math.abs(e.anchorX - e.width / 2) > 0.5 || Math.abs(e.anchorY - e.height / 2) > 0.5;
      expect(offCenter).toBe(true);
    }
  });
});
