import type { Metric } from "@projectqai/proto/metrics";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { describe, expect, it } from "vitest";

import {
  autoScaleUnit,
  convertUnit,
  formatMetricValue,
  getMetricCategory,
  hasDisplayFloor,
} from "./format-metrics";

function metric(unit: MetricUnit, value: number): Metric {
  return { unit, val: { case: "float", value } } as Metric;
}

describe("autoScaleUnit", () => {
  it("scales up past micro (1500 µSv/h -> 1.5 mSv/h)", () => {
    const { value, unit } = autoScaleUnit(1500, MetricUnit.MetricUnitMicrosievertPerHour);
    expect(value).toBe(1.5);
    expect(unit).toBe(MetricUnit.MetricUnitMillisievertPerHour);
  });

  it("floors accumulated dose at micro (80 nSv -> 0.08 µSv)", () => {
    const { value, unit } = autoScaleUnit(80, MetricUnit.MetricUnitNanosievert);
    expect(value).toBeCloseTo(0.08, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievert);
  });

  it("floors gray rate at micro (80 nGy/h -> 0.08 µGy/h)", () => {
    const { value, unit } = autoScaleUnit(80, MetricUnit.MetricUnitNanograyPerHour);
    expect(value).toBeCloseTo(0.08, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrograyPerHour);
  });

  it("floors gray dose at micro (80 nGy -> 0.08 µGy)", () => {
    const { value, unit } = autoScaleUnit(80, MetricUnit.MetricUnitNanogray);
    expect(value).toBeCloseTo(0.08, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrogray);
  });

  it("rescales a native centigray reading off centigray (5 cGy -> 50 mGy)", () => {
    const { value, unit } = autoScaleUnit(5, MetricUnit.MetricUnitCentigray);
    expect(value).toBe(50);
    expect(unit).toBe(MetricUnit.MetricUnitMilligray);
  });

  it("keeps zero in the floor unit (0 nSv/h -> 0 µSv/h)", () => {
    const { value, unit } = autoScaleUnit(0, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBe(0);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });

  it("preserves sign for negatives (-80 nSv/h -> -0.08 µSv/h)", () => {
    const { value, unit } = autoScaleUnit(-80, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBeCloseTo(-0.08, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });
});

describe("formatMetricValue", () => {
  it("sets an angle and a percentage against the number", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitDegree, 90))).toBe("90°");
    expect(formatMetricValue(metric(MetricUnit.MetricUnitPercent, 42))).toBe("42%");
  });

  it("keeps the space a unit abbreviation takes", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitMeter, 12))).toBe("12 m");
    expect(formatMetricValue(metric(MetricUnit.MetricUnitCelsius, 21))).toBe("21 °C");
  });

  it("formats a floored rate", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitNanosievertPerHour, 80))).toBe(
      "0.08 µSv/h",
    );
  });

  it("formats a value scaled into micro", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitNanosievertPerHour, 1380))).toBe(
      "1.38 µSv/h",
    );
  });

  it("formats large values in the base unit", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitMicrosievertPerHour, 2_000_000))).toBe(
      "2 Sv/h",
    );
  });

  it("formats gray dose like sievert, not centigray", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitMilligray, 50))).toBe("50 mGy");
  });

  it("formats a ratio as a percentage", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitRatio, 0.5))).toBe("50%");
  });

  it("scales a byte count to the largest decimal unit", () => {
    const bytes = (unit: MetricUnit, value: bigint) =>
      ({ unit, val: { case: "uint64", value } }) as Metric;

    expect(formatMetricValue(bytes(MetricUnit.MetricUnitByte, 31_914_983_424n))).toBe("31.91 GB");
    expect(formatMetricValue(bytes(MetricUnit.MetricUnitKilobyte, 2_105_540n))).toBe("2.11 GB");
    expect(formatMetricValue(bytes(MetricUnit.MetricUnitByte, 512n))).toBe("512 B");
  });

  it("scales a bit rate to the largest decimal unit", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitBitPerSecond, 2_450_000))).toBe(
      "2.45 Mbps",
    );
    expect(formatMetricValue(metric(MetricUnit.MetricUnitKilobitPerSecond, 0.75))).toBe("750 bps");
  });
});

describe("getMetricCategory", () => {
  it("groups area with the other spatial measurements", () => {
    expect(getMetricCategory({ kind: MetricKind.MetricKindArea } as Metric)).toBe("spatial");
  });
});

describe("hasDisplayFloor", () => {
  it("is true for every radiation family", () => {
    expect(hasDisplayFloor(MetricUnit.MetricUnitMicrosievertPerHour)).toBe(true);
    expect(hasDisplayFloor(MetricUnit.MetricUnitNanosievert)).toBe(true);
    expect(hasDisplayFloor(MetricUnit.MetricUnitMicrograyPerHour)).toBe(true);
    expect(hasDisplayFloor(MetricUnit.MetricUnitGray)).toBe(true);
    expect(hasDisplayFloor(MetricUnit.MetricUnitCentigray)).toBe(true);
  });

  it("is false for non-radiation units", () => {
    expect(hasDisplayFloor(MetricUnit.MetricUnitCelsius)).toBe(false);
    expect(hasDisplayFloor(MetricUnit.MetricUnitRatio)).toBe(false);
    expect(hasDisplayFloor(MetricUnit.MetricUnitCount)).toBe(false);
  });
});

describe("convertUnit", () => {
  it("converts within a family (1 Sv -> 1,000,000 µSv)", () => {
    expect(convertUnit(1, MetricUnit.MetricUnitSievert, MetricUnit.MetricUnitMicrosievert)).toBe(
      1_000_000,
    );
  });

  it("returns null across families (Sv -> Gy)", () => {
    expect(convertUnit(1, MetricUnit.MetricUnitSievert, MetricUnit.MetricUnitGray)).toBeNull();
  });
});
