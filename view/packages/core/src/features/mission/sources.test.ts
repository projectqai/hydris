import { create } from "@bufbuild/protobuf";
import type { EquipmentTaxonomySensor } from "@projectqai/proto/taxonomy";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState, EntitySchema } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import type { EntityInit } from "../../storybook/entities";
import { cameraClassification, entityMap, sensorClassification } from "../../storybook/entities";
import type { DeviceGroups, ServiceGroup } from "./sources";
import {
  getOtherServices,
  getReportedSourceKinds,
  getServiceLabel,
  getSourceServices,
  groupDevices,
} from "./sources";

const EW = sensorClassification({ kind: { case: "ew", value: {} } });

const RADAR = sensorClassification({ kind: { case: "radar", value: {} } });

function service(id: string, init: EntityInit = {}): Entity {
  return create(EntitySchema, {
    id,
    device: { state: DeviceState.DeviceStateActive },
    configurable: { state: ConfigurableState.ConfigurableStateActive },
    config: {},
    ...init,
  });
}

function device(id: string, parent: string, init: EntityInit = {}): Entity {
  return create(EntitySchema, {
    id,
    label: id,
    device: { parent, state: DeviceState.DeviceStateActive },
    ...init,
  });
}

type SensorKind = NonNullable<EquipmentTaxonomySensor["kind"]["case"]> | "sensor";

function bySource<T>(
  groups: DeviceGroups,
  entry: (group: ServiceGroup) => T,
): Partial<Record<SensorKind, T[]>> & { other: string[] } {
  return {
    ...Object.fromEntries(
      getReportedSourceKinds(groups).map((kind) => [
        kind,
        getSourceServices(kind, groups).map(entry),
      ]),
    ),
    other: getOtherServices(groups).map(({ serviceId }) => serviceId),
  };
}

function sourcesOf(entities: Entity[]) {
  return bySource(groupDevices(entityMap(entities)), ({ serviceId }) => serviceId);
}

describe("getSourceServices", () => {
  it("sends a service whose camera has no taxonomy to Other services", () => {
    const webcam = device("webcam-1", "webcam.service", {
      device: { parent: "webcam.service", class: "camera", state: DeviceState.DeviceStateActive },
      camera: { streams: [] },
    });

    expect(sourcesOf([service("webcam.service"), webcam])).toEqual({ other: ["webcam.service"] });
  });

  it("ignores the device classes a service declares", () => {
    const axis = service("axis.service", {
      configurable: {
        state: ConfigurableState.ConfigurableStateActive,
        supportedDeviceClasses: [{ class: "camera", label: "Camera" }],
      },
    });

    expect(sourcesOf([axis])).toEqual({ other: ["axis.service"] });
  });

  it("reads an electro-optical device by its taxonomy whatever its class and components", () => {
    const mast = device("mast-2", "mast.service", {
      device: { parent: "mast.service", class: "sensor", state: DeviceState.DeviceStateActive },
      sensor: {},
      classification: cameraClassification(),
    });

    expect(sourcesOf([service("mast.service"), mast])).toEqual({
      electroOptical: ["mast.service"],
      other: [],
    });
  });

  it("reads each sensor kind as its own source whatever the device class", () => {
    const node = device("rx-7", "perimeter.service", {
      device: {
        parent: "perimeter.service",
        class: "camera",
        state: DeviceState.DeviceStateActive,
      },
      classification: EW,
    });

    expect(sourcesOf([service("perimeter.service"), node])).toEqual({
      ew: ["perimeter.service"],
      other: [],
    });
  });

  it("reads every taxonomy entry, not only the first", () => {
    const ship = device("ship-cam", "ship.service", {
      classification: {
        taxonomy: [
          { kind: { case: "vehicle", value: {} } },
          { kind: { case: "equipment", value: {} } },
          ...(cameraClassification()?.taxonomy ?? []),
        ],
      },
    });

    expect(sourcesOf([service("ship.service"), ship])).toEqual({
      electroOptical: ["ship.service"],
      other: [],
    });
  });

  it("lists a service under the kind of each of its devices", () => {
    const camera = device("cam-1", "mixed.service", { classification: cameraClassification() });
    const node = device("sensor-1", "mixed.service", { classification: EW });

    expect(sourcesOf([service("mixed.service"), node, camera])).toEqual({
      electroOptical: ["mixed.service"],
      ew: ["mixed.service"],
      other: [],
    });
  });

  it("lists a service under every kind one device reports", () => {
    const head = device("head-1", "mast.service", {
      classification: {
        taxonomy: [...(cameraClassification()?.taxonomy ?? []), ...(RADAR?.taxonomy ?? [])],
      },
    });

    expect(sourcesOf([service("mast.service"), head])).toEqual({
      electroOptical: ["mast.service"],
      radar: ["mast.service"],
      other: [],
    });
  });

  it("ignores a service's own taxonomy until its devices report one", () => {
    const radar = service("radar.service", { classification: RADAR });
    const before = sourcesOf([radar]);
    const after = sourcesOf([radar, device("radar-1", "radar.service", { classification: RADAR })]);

    expect(before).toEqual({ other: ["radar.service"] });
    expect(after).toEqual({ radar: ["radar.service"], other: [] });
  });

  it("keeps children without a taxonomy under the service their siblings place", () => {
    const node = device("sensor-1", "perimeter.service", { classification: EW });
    const mast = device("sensor-1.mast", "sensor-1");
    const groups = groupDevices(entityMap([service("perimeter.service"), node, mast]));

    expect(getSourceServices("ew", groups)[0]?.devices.map(({ id }) => id)).toEqual([
      "sensor-1",
      "sensor-1.mast",
    ]);
  });
});

describe("getReportedSourceKinds", () => {
  it("orders the kinds as the proto declares them, sensors that give none last", () => {
    const groups = groupDevices(
      entityMap([
        device("cam-1", "gate.service", { classification: cameraClassification() }),
        device("node-1", "field.service", { classification: sensorClassification() }),
        device("rx-1", "perimeter.service", { classification: EW }),
        device("radar-1", "mast.service", { classification: RADAR }),
      ]),
    );

    expect(getReportedSourceKinds(groups)).toEqual(["radar", "ew", "electroOptical", "sensor"]);
  });
});

function placed(entities: Entity[]) {
  const groups = groupDevices(entityMap(entities));

  return {
    ...bySource(groups, (group) => ({
      label: getServiceLabel(group),
      missing: !group.service,
      devices: group.devices.map(({ id }) => id),
    })),
    withoutService: groups.withoutService.flatMap(({ devices }) => devices.map(({ id }) => id)),
  };
}

describe("groupDevices", () => {
  it("lists devices whose service is missing under the source they report, by the id they name", () => {
    expect(
      placed([
        device("sensor-2", "field.service", { classification: EW }),
        service("radar.service", { label: "Radar" }),
        device("radar-1", "radar.service", { classification: RADAR }),
        device("station-1", "gone.service"),
        device("sensor-1", "field.service", { classification: EW }),
        device("mast-cam", "mast.service", { classification: cameraClassification() }),
      ]),
    ).toEqual({
      electroOptical: [{ label: "mast.service", missing: true, devices: ["mast-cam"] }],
      ew: [{ label: "field.service", missing: true, devices: ["sensor-2", "sensor-1"] }],
      radar: [{ label: "Radar", missing: false, devices: ["radar-1"] }],
      other: [],
      withoutService: ["station-1"],
    });
  });

  it("follows a chain below the missing service, placed by its deepest device", () => {
    expect(
      placed([
        device("pole-1", "gone.service"),
        device("pole-1.head", "pole-1"),
        device("pole-1.head.cam", "pole-1.head", { classification: cameraClassification() }),
      ]),
    ).toMatchObject({
      electroOptical: [
        {
          label: "gone.service",
          missing: true,
          devices: ["pole-1", "pole-1.head", "pole-1.head.cam"],
        },
      ],
      withoutService: [],
    });
  });

  it("lists a missing service under the kind of each of its devices", () => {
    const mixed = { label: "mixed.service", missing: true, devices: ["sensor-1", "cam-1"] };

    expect(
      placed([
        device("sensor-1", "mixed.service", { classification: EW }),
        device("cam-1", "mixed.service", { classification: cameraClassification() }),
      ]),
    ).toEqual({
      electroOptical: [mixed],
      ew: [mixed],
      other: [],
      withoutService: [],
    });
  });

  it("names the missing service by its id when an entity without a device holds that id", () => {
    expect(
      placed([
        create(EntitySchema, { id: "field.service", label: "Field" }),
        device("sensor-1", "field.service", { classification: EW }),
      ]).ew,
    ).toEqual([{ label: "field.service", missing: true, devices: ["sensor-1"] }]);
  });

  it("puts the service in place of its missing entry under the same id once it arrives", () => {
    const node = device("sensor-1", "field.service", { classification: EW });
    const before = groupDevices(entityMap([node]));
    const after = groupDevices(entityMap([node, service("field.service", { label: "Field" })]));

    expect([...before.services.keys()]).toEqual(["field.service"]);
    expect([...after.services.keys()]).toEqual(["field.service"]);
    expect(before.services.get("field.service")?.service).toBeUndefined();
    expect(after.services.get("field.service")?.service?.label).toBe("Field");
    expect(after.services.get("field.service")?.devices).toEqual([node]);
  });
});

function withoutService(entities: Entity[]): [string, string[]][] {
  return groupDevices(entityMap(entities)).withoutService.map(({ serviceId, devices }) => [
    serviceId,
    devices.map(({ id }) => id),
  ]);
}

describe("devices without a service", () => {
  it("lists devices whose parent is not in the world, by missing service id, then label", () => {
    expect(
      placed([
        device("sensor-1", "sensor.service", { label: "Sensor Bravo" }),
        device("relay-1", "relay.service", { label: "Zulu relay" }),
        device("sensor-2", "sensor.service", { label: "Sensor Alpha" }),
      ]).withoutService,
    ).toEqual(["relay-1", "sensor-2", "sensor-1"]);
  });

  it("leaves out roots and devices beneath a service in the world", () => {
    expect(
      placed([
        service("axis.service", { label: "AXIS Cameras" }),
        device("axis.cam-1", "axis.service", { label: "Gate" }),
        device("sensor-1", "sensor.service", { label: "Sensor Bravo" }),
        create(EntitySchema, { id: "trk-1", label: "TANGO 21" }),
      ]).withoutService,
    ).toEqual(["sensor-1"]);
  });

  it("lists a device beneath a device whose service is missing, under the missing service", () => {
    expect(
      withoutService([
        device("sensor-1", "sensor.service", { label: "Sensor Bravo" }),
        device("sensor-1.mast", "sensor-1", { label: "Mast" }),
        device("sensor-1.mast.light", "sensor-1.mast", { label: "Light" }),
        device("relay-1", "relay.service", { label: "Zulu relay" }),
      ]),
    ).toEqual([
      ["relay.service", ["relay-1"]],
      ["sensor.service", ["sensor-1.mast.light", "sensor-1.mast", "sensor-1"]],
    ]);
  });

  const configurable = { supportedDeviceClasses: [{ class: "sensor", label: "Sensor" }] };

  const parentsThatAreNotDevices = [
    ["only a configurable", create(EntitySchema, { id: "sensor.service", configurable })],
    [
      "a configurable with a config",
      create(EntitySchema, { id: "sensor.service", configurable, config: {} }),
    ],
    ["neither", create(EntitySchema, { id: "sensor.service" })],
  ] as const;

  it.each(parentsThatAreNotDevices)(
    "lists devices under a parent in the world with %s and no device, under its id",
    (_, parent) => {
      expect(
        withoutService([
          parent,
          device("sensor-1", "sensor.service", { label: "Sensor Bravo" }),
          device("sensor-2", "sensor.service", { label: "Sensor Alpha" }),
          device("sensor-2.lamp", "sensor-2", { label: "Lamp" }),
          device("relay-1", "relay.service", { label: "Zulu relay" }),
        ]),
      ).toEqual([
        ["relay.service", ["relay-1"]],
        ["sensor.service", ["sensor-2.lamp", "sensor-2", "sensor-1"]],
      ]);
    },
  );

  it("moves the devices back under the service once the parent is a device again", () => {
    const entities = entityMap([
      create(EntitySchema, { id: "sensor.service", configurable }),
      device("sensor-1", "sensor.service", { label: "Sensor Bravo" }),
      device("sensor-1.lamp", "sensor-1", { label: "Lamp" }),
    ]);

    expect(
      groupDevices(entities).withoutService.flatMap((g) => g.devices.map((e) => e.id)),
    ).toEqual(["sensor-1.lamp", "sensor-1"]);

    entities.set("sensor.service", service("sensor.service", { label: "Sensor service" }));

    const groups = groupDevices(entities);

    expect(groups.withoutService).toEqual([]);
    expect(groups.services.get("sensor.service")?.devices.map((e) => e.id)).toEqual([
      "sensor-1",
      "sensor-1.lamp",
    ]);
  });
});
