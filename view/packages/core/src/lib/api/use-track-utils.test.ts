import type { Entity } from "@projectqai/proto/world";
import { DeviceState } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import {
  getAssetCategory,
  getBattleDimension,
  getBattleDimensionRank,
  isAsset,
  isRepositionable,
  isTrack,
} from "./use-track-utils";

const SYMBOL = { milStd2525C: "SFGPU-----" };
const GEO = { latitude: 1, longitude: 2 };

function entity(partial: Partial<Entity> = {}): Entity {
  return { id: "e", ...partial } as Entity;
}

describe("isAsset", () => {
  it("is true with a device state and a symbol, even when pending (zero)", () => {
    const withState = (state: DeviceState) =>
      isAsset(entity({ symbol: SYMBOL, device: { state } } as Partial<Entity>));
    expect(withState(DeviceState.DeviceStateActive)).toBe(true);
    expect(withState(DeviceState.DeviceStatePending)).toBe(true);
  });

  it("is false without a device state, or without a symbol", () => {
    expect(isAsset(entity({ symbol: SYMBOL } as Partial<Entity>))).toBe(false);
    expect(
      isAsset(entity({ device: { state: DeviceState.DeviceStateActive } } as Partial<Entity>)),
    ).toBe(false);
    expect(isAsset(entity({ symbol: SYMBOL, geo: GEO } as Partial<Entity>))).toBe(false);
  });
});

describe("isTrack", () => {
  it("is true only with geo, symbol, and a track component", () => {
    expect(isTrack(entity({ symbol: SYMBOL, geo: GEO, track: {} } as Partial<Entity>))).toBe(true);
  });

  it("is false when geo, symbol, or track is missing", () => {
    expect(isTrack(entity({ symbol: SYMBOL, geo: GEO } as Partial<Entity>))).toBe(false);
    expect(isTrack(entity({ symbol: SYMBOL, track: {} } as Partial<Entity>))).toBe(false);
    expect(isTrack(entity({ geo: GEO, track: {} } as Partial<Entity>))).toBe(false);
  });
});

describe("isRepositionable", () => {
  it("is true with a symbol and no pose, even when track-owned without geo", () => {
    expect(isRepositionable(entity({ symbol: SYMBOL } as Partial<Entity>))).toBe(true);
    expect(isRepositionable(entity({ symbol: SYMBOL, track: {} } as Partial<Entity>))).toBe(true);
  });

  it("is false without a symbol, or when pose-attached", () => {
    expect(isRepositionable(entity())).toBe(false);
    expect(isRepositionable(entity({ symbol: SYMBOL, pose: {} } as Partial<Entity>))).toBe(false);
  });
});

function classified(kind: string, value: object = {}): Partial<Entity> {
  return { classification: { taxonomy: [{ kind: { case: kind, value } }] } } as Partial<Entity>;
}

const symbol = (milStd2525C: string): Partial<Entity> =>
  ({ symbol: { milStd2525C } }) as Partial<Entity>;

describe("getAssetCategory", () => {
  it("names the bucket after the taxonomy kind", () => {
    expect(
      getAssetCategory(entity(classified("vehicle", { domain: { case: "sea", value: {} } }))),
    ).toBe("Vehicle");
    expect(getAssetCategory(entity(classified("equipment")))).toBe("Equipment");
    expect(getAssetCategory(entity(classified("person")))).toBe("Person");
  });

  it("title-cases a multi-word kind, so a new proto kind needs no client change", () => {
    expect(getAssetCategory(entity(classified("electro_optical")))).toBe("Electro Optical");
  });

  it("is Unclassified when the engine sets no taxonomy", () => {
    expect(getAssetCategory(entity(symbol("SFGP------")))).toBe("Unclassified");
    expect(getAssetCategory(entity())).toBe("Unclassified");
  });
});

describe("getBattleDimension", () => {
  it("reads the dimension from SIDC position [2]", () => {
    expect(getBattleDimension(entity(symbol("SFAP------")))).toBe("Air");
    expect(getBattleDimension(entity(symbol("SFGP------")))).toBe("Ground");
    expect(getBattleDimension(entity(symbol("SFSP------")))).toBe("Sea Surface");
    expect(getBattleDimension(entity(symbol("SFUP------")))).toBe("Subsurface");
  });

  it("is Unknown without a symbol", () => {
    expect(getBattleDimension(entity())).toBe("Unknown");
  });
});

describe("getBattleDimensionRank", () => {
  it("orders dimensions air < ground < sea < subsurface", () => {
    const rank = (sidc: string) => getBattleDimensionRank(entity(symbol(sidc)));
    expect(rank("SFAP------")).toBeLessThan(rank("SFGP------"));
    expect(rank("SFGP------")).toBeLessThan(rank("SFSP------"));
    expect(rank("SFSP------")).toBeLessThan(rank("SFUP------"));
  });

  it("is zero without a dimension", () => {
    expect(getBattleDimensionRank(entity())).toBe(0);
  });
});
