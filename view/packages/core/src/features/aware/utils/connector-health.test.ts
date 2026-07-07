import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { deriveConnectorHealth } from "./connector-health";

function entity(partial: Partial<Entity> = {}): Entity {
  return { id: "e", ...partial } as Entity;
}

describe("deriveConnectorHealth — link (on a connector)", () => {
  const conn = (status: LinkStatus) => entity({ device: {}, link: { status } } as Partial<Entity>);
  it("maps Connected/Degraded/Lost to healthy/degraded/failed", () => {
    expect(deriveConnectorHealth(conn(LinkStatus.LinkStatusConnected))).toBe("healthy");
    expect(deriveConnectorHealth(conn(LinkStatus.LinkStatusDegraded))).toBe("degraded");
    expect(deriveConnectorHealth(conn(LinkStatus.LinkStatusLost))).toBe("failed");
  });

  it("ignores a link on a non-connector (plain asset)", () => {
    expect(
      deriveConnectorHealth(
        entity({ link: { status: LinkStatus.LinkStatusLost } } as Partial<Entity>),
      ),
    ).toBeUndefined();
  });
});

describe("deriveConnectorHealth — configurable", () => {
  const cases: [ConfigurableState, "healthy" | "degraded" | "failed" | undefined][] = [
    [ConfigurableState.ConfigurableStateActive, "healthy"],
    [ConfigurableState.ConfigurableStateScheduled, "healthy"],
    [ConfigurableState.ConfigurableStateStarting, "degraded"],
    [ConfigurableState.ConfigurableStateFailed, "failed"],
    [ConfigurableState.ConfigurableStateConflict, "failed"],
    [ConfigurableState.ConfigurableStateInactive, undefined],
  ];
  for (const [state, expected] of cases) {
    it(`maps ${ConfigurableState[state]} to ${expected}`, () => {
      expect(
        deriveConnectorHealth(entity({ configurable: { state, error: "" } } as Partial<Entity>)),
      ).toBe(expected);
    });
  }
});

describe("deriveConnectorHealth — device", () => {
  it("maps Active/Degraded/Pending/Failed to healthy/degraded/degraded/failed", () => {
    expect(
      deriveConnectorHealth(
        entity({ device: { state: DeviceState.DeviceStateActive } } as Partial<Entity>),
      ),
    ).toBe("healthy");
    expect(
      deriveConnectorHealth(
        entity({ device: { state: DeviceState.DeviceStateDegraded } } as Partial<Entity>),
      ),
    ).toBe("degraded");
    expect(
      deriveConnectorHealth(
        entity({ device: { state: DeviceState.DeviceStatePending } } as Partial<Entity>),
      ),
    ).toBe("degraded");
    expect(
      deriveConnectorHealth(
        entity({ device: { state: DeviceState.DeviceStateFailed } } as Partial<Entity>),
      ),
    ).toBe("failed");
  });
});

describe("deriveConnectorHealth — priority and non-connectors", () => {
  it("prefers link over configurable", () => {
    const e = entity({
      link: { status: LinkStatus.LinkStatusLost },
      configurable: { state: ConfigurableState.ConfigurableStateActive, error: "" },
    } as Partial<Entity>);
    expect(deriveConnectorHealth(e)).toBe("failed");
  });

  it("prefers device over configurable", () => {
    const e = entity({
      device: { state: DeviceState.DeviceStatePending },
      configurable: { state: ConfigurableState.ConfigurableStateActive, error: "" },
    } as Partial<Entity>);
    expect(deriveConnectorHealth(e)).toBe("degraded");
  });

  it("returns undefined for a non-connector entity", () => {
    expect(
      deriveConnectorHealth(entity({ geo: { latitude: 1, longitude: 2 } } as Partial<Entity>)),
    ).toBeUndefined();
  });
});
