import type { Entity } from "@projectqai/proto/world";
import { DeviceState, LinkStatus } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { deriveAssetReadiness, readinessSeverity, worstBlocker } from "./asset-readiness";

const SYMBOL = { milStd2525C: "SFGPU-----" };
const GEO = { latitude: 1, longitude: 2 };

function entity(partial: Partial<Entity> = {}): Entity {
  return { id: "e", ...partial } as Entity;
}

describe("deriveAssetReadiness — position gate", () => {
  it("is unmet until the asset has geo", () => {
    expect(deriveAssetReadiness(entity({ symbol: SYMBOL } as Partial<Entity>)).ready).toBe(false);
    expect(
      deriveAssetReadiness(entity({ symbol: SYMBOL, geo: GEO } as Partial<Entity>)).ready,
    ).toBe(true);
  });
});

describe("deriveAssetReadiness — device gate", () => {
  const dev = (state: DeviceState) =>
    entity({ symbol: SYMBOL, geo: GEO, device: { state } } as Partial<Entity>);

  it("only applies when device is present", () => {
    const r = deriveAssetReadiness(entity({ symbol: SYMBOL, geo: GEO } as Partial<Entity>));
    expect(r.gates.some((g) => g.key === "device")).toBe(false);
  });

  it("is met for Active, not ready otherwise", () => {
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStateActive)).ready).toBe(true);
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStatePending)).ready).toBe(false);
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStateDegraded)).ready).toBe(false);
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStateFailed)).ready).toBe(false);
  });

  it("flags failed only for Failed", () => {
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStateFailed)).failed).toBe(true);
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStateDegraded)).failed).toBe(false);
    expect(deriveAssetReadiness(dev(DeviceState.DeviceStateActive)).failed).toBe(false);
  });
});

describe("deriveAssetReadiness — link gate", () => {
  const placed = (status: LinkStatus) =>
    entity({ symbol: SYMBOL, geo: GEO, link: { status } } as Partial<Entity>);

  it("is met only for Connected", () => {
    expect(deriveAssetReadiness(placed(LinkStatus.LinkStatusConnected)).ready).toBe(true);
    expect(deriveAssetReadiness(placed(LinkStatus.LinkStatusDegraded)).ready).toBe(false);
    expect(deriveAssetReadiness(placed(LinkStatus.LinkStatusLost)).ready).toBe(false);
  });

  it("flags failed for Lost", () => {
    expect(deriveAssetReadiness(placed(LinkStatus.LinkStatusLost)).failed).toBe(true);
    expect(deriveAssetReadiness(placed(LinkStatus.LinkStatusConnected)).failed).toBe(false);
  });

  it("does not flag failed for a lost link still blocked on the device", () => {
    const e = entity({
      symbol: SYMBOL,
      geo: GEO,
      device: { state: DeviceState.DeviceStatePending },
      link: { status: LinkStatus.LinkStatusLost },
    } as Partial<Entity>);
    const r = deriveAssetReadiness(e);
    expect(r.gates.find((g) => g.key === "link")?.status).toBe("blocked");
    expect(r.failed).toBe(false);
  });
});

describe("deriveAssetReadiness — rollup", () => {
  it("ready requires every applicable gate met", () => {
    const e = entity({
      symbol: SYMBOL,
      geo: GEO,
      device: { state: DeviceState.DeviceStateActive },
      link: { status: LinkStatus.LinkStatusConnected },
    } as Partial<Entity>);
    expect(deriveAssetReadiness(e).ready).toBe(true);
  });
});

describe("deriveAssetReadiness — gate status", () => {
  const gateStatus = (e: Entity, key: string) =>
    deriveAssetReadiness(e).gates.find((g) => g.key === key)?.status;

  it("reports the position gate as unmet until placed", () => {
    expect(gateStatus(entity({ symbol: SYMBOL } as Partial<Entity>), "position")).toBe("unmet");
    expect(gateStatus(entity({ symbol: SYMBOL, geo: GEO } as Partial<Entity>), "position")).toBe(
      "met",
    );
  });

  it("maps device state to gate status", () => {
    const dev = (state: DeviceState) =>
      entity({ symbol: SYMBOL, geo: GEO, device: { state } } as Partial<Entity>);
    expect(gateStatus(dev(DeviceState.DeviceStateFailed), "device")).toBe("failed");
    expect(gateStatus(dev(DeviceState.DeviceStatePending), "device")).toBe("pending");
    expect(gateStatus(dev(DeviceState.DeviceStateDegraded), "device")).toBe("degraded");
    expect(gateStatus(dev(DeviceState.DeviceStateActive), "device")).toBe("met");
  });

  it("blocks the link gate until the device is met, then evaluates it", () => {
    const withDevice = (state: DeviceState, status: LinkStatus) =>
      entity({
        symbol: SYMBOL,
        geo: GEO,
        device: { state },
        link: { status },
      } as Partial<Entity>);
    expect(
      gateStatus(
        withDevice(DeviceState.DeviceStatePending, LinkStatus.LinkStatusConnected),
        "link",
      ),
    ).toBe("blocked");
    expect(
      gateStatus(withDevice(DeviceState.DeviceStateActive, LinkStatus.LinkStatusLost), "link"),
    ).toBe("failed");
  });
});

describe("worstBlocker", () => {
  it("surfaces a failed device over an earlier no-position gate", () => {
    const e = entity({
      symbol: SYMBOL,
      device: { state: DeviceState.DeviceStateFailed },
    } as Partial<Entity>);
    const b = worstBlocker(deriveAssetReadiness(e));
    expect(b?.key).toBe("device");
    expect(b?.status).toBe("failed");
  });

  it("surfaces a failed link over an earlier no-position gate", () => {
    const e = entity({
      symbol: SYMBOL,
      device: { state: DeviceState.DeviceStateActive },
      link: { status: LinkStatus.LinkStatusLost },
    } as Partial<Entity>);
    const b = worstBlocker(deriveAssetReadiness(e));
    expect(b?.key).toBe("link");
    expect(b?.status).toBe("failed");
  });

  it("surfaces a degraded gate over an earlier no-position gate", () => {
    const e = entity({
      symbol: SYMBOL,
      device: { state: DeviceState.DeviceStateDegraded },
    } as Partial<Entity>);
    expect(worstBlocker(deriveAssetReadiness(e))?.status).toBe("degraded");
  });

  it("is undefined when every gate is met", () => {
    const e = entity({
      symbol: SYMBOL,
      geo: GEO,
      device: { state: DeviceState.DeviceStateActive },
      link: { status: LinkStatus.LinkStatusConnected },
    } as Partial<Entity>);
    expect(worstBlocker(deriveAssetReadiness(e))).toBeUndefined();
  });
});

describe("readinessSeverity", () => {
  it("is 0 when ready and ranks higher the worse the blocker", () => {
    const ready = readinessSeverity(
      entity({
        symbol: SYMBOL,
        geo: GEO,
        device: { state: DeviceState.DeviceStateActive },
        link: { status: LinkStatus.LinkStatusConnected },
      } as Partial<Entity>),
    );
    const noPosition = readinessSeverity(
      entity({
        symbol: SYMBOL,
        device: { state: DeviceState.DeviceStateActive },
      } as Partial<Entity>),
    );
    const degraded = readinessSeverity(
      entity({
        symbol: SYMBOL,
        geo: GEO,
        device: { state: DeviceState.DeviceStateDegraded },
      } as Partial<Entity>),
    );
    const failed = readinessSeverity(
      entity({
        symbol: SYMBOL,
        geo: GEO,
        device: { state: DeviceState.DeviceStateFailed },
      } as Partial<Entity>),
    );
    expect(ready).toBe(0);
    expect(noPosition).toBeGreaterThan(0);
    expect(degraded).toBeGreaterThan(noPosition);
    expect(failed).toBeGreaterThan(degraded);
  });
});
