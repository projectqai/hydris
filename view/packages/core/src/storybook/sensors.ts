import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";

import { ago } from "./clock";
import type { EntityInit } from "./entities";
import { entity, sensorClassification } from "./entities";

const SENSOR_CLASSES = [{ class: "sensor", label: "Sensor" }];

export const WEATHER_ID = "weather.service";

export function sensorService(id: string, label: string, init?: EntityInit): Entity {
  return entity(id, {
    label,
    device: { category: "Sensors", state: DeviceState.DeviceStateActive },
    configurable: {
      supportedDeviceClasses: SENSOR_CLASSES,
      state: ConfigurableState.ConfigurableStateActive,
    },
    config: {},
    ...init,
  });
}

export function sensor(
  id: string,
  label: string,
  state = DeviceState.DeviceStateActive,
  parent = WEATHER_ID,
): Entity {
  return entity(id, {
    label,
    device: { parent, class: "sensor", state },
    classification: sensorClassification(),
  });
}

export const weatherService = sensorService(WEATHER_ID, "Weather station");

export const sensorAwaitingSetup = entity("weather.device.mast-3", {
  label: "Mast sensor 3",
  configurable: { label: "Mast sensor 3" },
  device: { parent: WEATHER_ID, class: "sensor", state: DeviceState.DeviceStatePending },
  classification: sensorClassification(),
});

export const RIVER_GAUGES_ID = "gauge.service";

const riverGaugesService = sensorService(RIVER_GAUGES_ID, "River gauges");

const GAUGE_IDS = Array.from({ length: 6 }, (_, i) => `gauge-${String(i + 1).padStart(2, "0")}`);

type GaugeInit = { link?: LinkStatus; pump?: DeviceState };

function gauge(id: string, init: GaugeInit): Entity[] {
  const { link = LinkStatus.LinkStatusConnected, pump = DeviceState.DeviceStateActive } = init;

  return [
    entity(id, {
      device: { parent: RIVER_GAUGES_ID, state: DeviceState.DeviceStateActive },
      configurable: {},
      power: { batteryChargeRemaining: 0.92 },
      link: { status: link, lastSeen: ago(137) },
      sensor: {},
      classification: sensorClassification(),
    }),
    entity(`${id}.rain`, {
      label: "Rain sensor",
      device: { parent: id, state: DeviceState.DeviceStateActive },
    }),
    entity(`${id}.pump`, {
      device: { parent: id, state: pump },
      configurable: {},
    }),
  ];
}

export function riverGauges(overrides: Record<string, GaugeInit> = {}): Entity[] {
  return [riverGaugesService, ...GAUGE_IDS.flatMap((id) => gauge(id, overrides[id] ?? {}))];
}

export const sensorServiceNotSetUp = entity("buoy.service", {
  label: "Harbour buoys",
  device: { category: "Sensors" },
  configurable: { supportedDeviceClasses: SENSOR_CLASSES },
});
