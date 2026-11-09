import { create } from "@bufbuild/protobuf";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, EntitySchema, LinkStatus } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { deriveConnectorHealth } from "./connector-health";

function setUpService(
  state: ConfigurableState,
  deviceState: DeviceState,
  linkStatus?: LinkStatus,
): Entity {
  return create(EntitySchema, {
    id: "link.service",
    configurable: { state },
    config: {},
    device: { state: deviceState },
    link: linkStatus === undefined ? undefined : { status: linkStatus },
  });
}

describe("deriveConnectorHealth", () => {
  it("shows a failed service as failed while its link is connected", () => {
    const entity = setUpService(
      ConfigurableState.ConfigurableStateFailed,
      DeviceState.DeviceStateActive,
      LinkStatus.LinkStatusConnected,
    );

    expect(deriveConnectorHealth(entity)).toBe("failed");
  });

  it("ignores a failed device state left over from a stopped run", () => {
    const entity = setUpService(
      ConfigurableState.ConfigurableStateInactive,
      DeviceState.DeviceStateFailed,
    );

    expect(deriveConnectorHealth(entity)).toBeUndefined();
  });

  it("counts a lost link on a running service", () => {
    const entity = setUpService(
      ConfigurableState.ConfigurableStateActive,
      DeviceState.DeviceStateActive,
      LinkStatus.LinkStatusLost,
    );

    expect(deriveConnectorHealth(entity)).toBe("failed");
  });

  it("shows a running service as healthy", () => {
    const entity = setUpService(
      ConfigurableState.ConfigurableStateActive,
      DeviceState.DeviceStateActive,
      LinkStatus.LinkStatusConnected,
    );

    expect(deriveConnectorHealth(entity)).toBe("healthy");
  });

  it("leaves out a discovered device that is not set up", () => {
    const entity = create(EntitySchema, {
      id: "serial.device.1",
      device: { parent: "link.service", state: DeviceState.DeviceStatePending },
    });

    expect(deriveConnectorHealth(entity)).toBeUndefined();
  });

  it("ignores a link on a plain asset", () => {
    const entity = create(EntitySchema, {
      id: "asset-1",
      link: { status: LinkStatus.LinkStatusLost },
    });

    expect(deriveConnectorHealth(entity)).toBeUndefined();
  });
});
