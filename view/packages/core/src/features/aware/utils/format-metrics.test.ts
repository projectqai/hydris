import type { Metric } from "@projectqai/proto/metrics";
import { MetricUnit } from "@projectqai/proto/metrics";
import { describe, expect, it } from "vitest";

import {
  autoScaleUnit,
  convertUnit,
  formatMetricValue,
  hasDisplayFloor,
  scaleForDisplay,
} from "./format-metrics";

function metric(unit: MetricUnit, value: number): Metric {
  return { unit, val: { case: "float", value } } as Metric;
}

describe("autoScaleUnit", () => {
  it("floors dose-equivalent rate at micro (80 nSv/h -> 0.08 µSv/h)", () => {
    const { value, unit } = autoScaleUnit(80, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBeCloseTo(0.08, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });

  it("keeps two significant decimals while flooring (1380 nSv/h -> 1.38 µSv/h)", () => {
    const { value, unit } = autoScaleUnit(1380, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBeCloseTo(1.38, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });

  it("scales up past micro (1500 µSv/h -> 1.5 mSv/h)", () => {
    const { value, unit } = autoScaleUnit(1500, MetricUnit.MetricUnitMicrosievertPerHour);
    expect(value).toBe(1.5);
    expect(unit).toBe(MetricUnit.MetricUnitMillisievertPerHour);
  });

  it("scales rate up to the base unit (2,000,000 µSv/h -> 2 Sv/h)", () => {
    const { value, unit } = autoScaleUnit(2_000_000, MetricUnit.MetricUnitMicrosievertPerHour);
    expect(value).toBe(2);
    expect(unit).toBe(MetricUnit.MetricUnitSievertPerHour);
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

  it("skips centigray so gray dose scales like sievert (50 mGy -> 50 mGy)", () => {
    const { value, unit } = autoScaleUnit(50, MetricUnit.MetricUnitMilligray);
    expect(value).toBe(50);
    expect(unit).toBe(MetricUnit.MetricUnitMilligray);
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

  it("selects micro exactly at the boundary (1000 nSv/h -> 1 µSv/h)", () => {
    const { value, unit } = autoScaleUnit(1000, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBe(1);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });

  it("stays floored just below the boundary (999 nSv/h -> 0.999 µSv/h)", () => {
    const { value, unit } = autoScaleUnit(999, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBeCloseTo(0.999, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });

  it("passes non-radiation units through unchanged", () => {
    const { value, unit } = autoScaleUnit(42, MetricUnit.MetricUnitCelsius);
    expect(value).toBe(42);
    expect(unit).toBe(MetricUnit.MetricUnitCelsius);
  });
});

describe("scaleForDisplay", () => {
  it("expands a ratio to a percentage, leaving the unit", () => {
    const { value, unit } = scaleForDisplay(0.5, MetricUnit.MetricUnitRatio);
    expect(value).toBe(50);
    expect(unit).toBe(MetricUnit.MetricUnitRatio);
  });

  it("delegates dose units to the auto-scale floor", () => {
    const { value, unit } = scaleForDisplay(80, MetricUnit.MetricUnitNanosievertPerHour);
    expect(value).toBeCloseTo(0.08, 10);
    expect(unit).toBe(MetricUnit.MetricUnitMicrosievertPerHour);
  });

  it("passes plain units through", () => {
    const { value, unit } = scaleForDisplay(42, MetricUnit.MetricUnitCelsius);
    expect(value).toBe(42);
    expect(unit).toBe(MetricUnit.MetricUnitCelsius);
  });
});

describe("formatMetricValue", () => {
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
    expect(formatMetricValue(metric(MetricUnit.MetricUnitRatio, 0.5))).toBe("50 %");
  });

  it("formats a plain unit unchanged", () => {
    expect(formatMetricValue(metric(MetricUnit.MetricUnitCelsius, 36))).toBe("36 °C");
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

  it("converts a rate within a family (1000 nSv/h -> 1 µSv/h)", () => {
    expect(
      convertUnit(
        1000,
        MetricUnit.MetricUnitNanosievertPerHour,
        MetricUnit.MetricUnitMicrosievertPerHour,
      ),
    ).toBe(1);
  });

  it("returns the same value for identical units", () => {
    expect(
      convertUnit(5, MetricUnit.MetricUnitMicrosievert, MetricUnit.MetricUnitMicrosievert),
    ).toBe(5);
  });

  it("returns null across families (Sv -> Gy)", () => {
    expect(convertUnit(1, MetricUnit.MetricUnitSievert, MetricUnit.MetricUnitGray)).toBeNull();
  });
});
