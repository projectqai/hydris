import { create } from "@bufbuild/protobuf";
import type { Entity } from "@projectqai/proto/world";
import { DeviceState, EntitySchema } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { entityMap } from "../../storybook/entities";
import { getDevicesBelow } from "./device-tree";

function device(id: string, label: string, parent?: string): Entity {
  return create(EntitySchema, {
    id,
    label,
    device: { parent, class: "sensor", state: DeviceState.DeviceStateActive },
  });
}

describe("devices below a device", () => {
  it("lists every device under it at any depth, and nothing beside or above it", () => {
    const devices = [
      device("sensor-1", "Sensor 1", "gauge.service"),
      device("sensor-1.mast", "Mast", "sensor-1"),
      device("sensor-1.mast.light", "Light", "sensor-1.mast"),
      device("sensor-2", "Sensor 2", "gauge.service"),
      device("sensor-2.mast", "Mast", "sensor-2"),
    ];

    const entities = entityMap([device("gauge.service", "River gauges"), ...devices]);

    expect(getDevicesBelow(entities, devices, "sensor-1").map((e) => e.id)).toEqual([
      "sensor-1.mast",
      "sensor-1.mast.light",
    ]);
  });
});
