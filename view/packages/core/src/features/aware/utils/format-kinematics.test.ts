import type { KinematicsEnu, OrientationComponent } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import {
  calculateCourseFromVelocity,
  calculateGroundSpeed,
  calculateHeadingFromOrientation,
  calculateVerticalRate,
  formatAcceleration,
  formatArea,
  formatDistance,
  formatElevationAngle,
  formatRangeReadout,
  formatTrueBearing,
} from "./format-kinematics";

describe("formatArea", () => {
  it.each([
    [0, "0 m²"],
    [99_999, "99,999 m²"],
    [100_000, "0.10 km²"],
  ])("formats %s square meters", (squareMeters, expected) => {
    expect(formatArea(squareMeters)).toBe(expected);
  });
});

describe("formatDistance", () => {
  it("keeps the standard kilometer precision", () => {
    expect(formatDistance(1_550)).toBe("1.6km");
  });

  it("uses hundredths for nearby kilometer measurements", () => {
    expect(formatDistance(1_550, { precision: "precise" })).toBe("1.55km");
  });

  it("keeps hundredths at a nearby round kilometer", () => {
    expect(formatDistance(2_000, { precision: "precise" })).toBe("2.00km");
  });

  it("keeps hundredths past ten kilometers", () => {
    expect(formatDistance(12_300, { precision: "precise" })).toBe("12.30km");
  });

  it("spaces a kilometer unit when requested", () => {
    expect(formatDistance(1_550, { precision: "precise", unitStyle: "spaced" })).toBe("1.55 km");
  });
});

describe("formatRangeReadout", () => {
  it("names ground distance when slant range is unavailable", () => {
    expect(formatRangeReadout(260, null)).toBe("260 m GD");
  });

  it("names slant range when altitude is available", () => {
    expect(formatRangeReadout(260, 261)).toBe("261 m SR");
  });
});

describe("formatElevationAngle", () => {
  it("shows an explicit positive sign", () => {
    expect(formatElevationAngle(11.6)).toBe("+12°");
  });

  it("preserves a negative sign", () => {
    expect(formatElevationAngle(-4.6)).toBe("-5°");
  });

  it("shows values that round to zero as positive", () => {
    expect(formatElevationAngle(-0.4)).toBe("+0°");
  });
});

describe("formatTrueBearing", () => {
  it("pads bearings to three digits", () => {
    expect(formatTrueBearing(9.2)).toBe("009°T");
  });

  it("wraps a rounded bearing at true north", () => {
    expect(formatTrueBearing(359.6)).toBe("000°T");
  });
});

function velocity(east: number, north: number, up: number): KinematicsEnu {
  return { east, north, up } as KinematicsEnu;
}

describe("a reading of zero is not a missing reading", () => {
  it("reports a stationary track as zero speed, not unknown", () => {
    expect(calculateGroundSpeed(velocity(0, 0, 0))).toBe(0);
  });

  it("reports level flight as zero vertical rate, not unknown", () => {
    expect(calculateVerticalRate({ up: 0 })).toBe(0);
  });

  it("reports zero acceleration rather than a dash", () => {
    expect(formatAcceleration(velocity(0, 0, 0))).toBe("0.00 m/s²");
  });

  it("still reports unknown when the component is absent", () => {
    expect(calculateGroundSpeed(undefined)).toBeUndefined();
    expect(calculateVerticalRate(undefined)).toBeUndefined();
    expect(formatAcceleration(undefined)).toBe("—");
  });

  it("leaves course unknown when there is no motion to take a direction from", () => {
    expect(calculateCourseFromVelocity(velocity(0, 0, 0))).toBeUndefined();
  });
});

// aerospace ZYX intrinsic, matching the producers
function attitude(yawDeg: number, pitchDeg: number, rollDeg: number): OrientationComponent {
  const [y, p, r] = [yawDeg, pitchDeg, rollDeg].map((d) => (d * Math.PI) / 180 / 2);
  const [cy, sy, cp, sp, cr, sr] = [
    Math.cos(y!),
    Math.sin(y!),
    Math.cos(p!),
    Math.sin(p!),
    Math.cos(r!),
    Math.sin(r!),
  ];
  return {
    orientation: {
      w: cr * cp * cy + sr * sp * sy,
      x: sr * cp * cy - cr * sp * sy,
      y: cr * sp * cy + sr * cp * sy,
      z: cr * cp * sy - sr * sp * cy,
    },
  } as OrientationComponent;
}

describe("calculateHeadingFromOrientation", () => {
  it("recovers the heading when past north", () => {
    expect(calculateHeadingFromOrientation(attitude(350, 15, 25))).toBeCloseTo(350, 9);
  });

  it("is unknown without an orientation", () => {
    expect(calculateHeadingFromOrientation(undefined)).toBeUndefined();
  });
});
