import type { MessageInitShape } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { Entity, MissionPack } from "@projectqai/proto/world";
import {
  ConfigurableState,
  DeviceState,
  EntitySchema,
  MissionPackSchema,
} from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import type { EntityInit } from "../../storybook/entities";
import {
  cameraClassification,
  entityMap,
  sensorClassification,
  setUpCamera,
} from "../../storybook/entities";
import { getMissionState, getOwnState, getSourcesState } from "../mission/provider-state";
import { getReportedSourceKinds, groupDevices } from "../mission/sources";
import {
  computeStatic,
  formatBytes,
  getDoneAction,
  getSourceRow,
  getSourcesSections,
} from "./mission-health-compute";

const SERVICE_ID = "video.service";

function pack(init: MessageInitShape<typeof MissionPackSchema> = {}): MissionPack {
  return create(MissionPackSchema, init);
}

function cameraService(state: ConfigurableState): Entity {
  return create(EntitySchema, {
    id: SERVICE_ID,
    label: "Video service",
    device: {},
    configurable: { state, supportedDeviceClasses: [{ class: "camera", label: "Camera" }] },
    config: {},
  });
}

function otherService(id: string, label: string, state: ConfigurableState): Entity {
  return create(EntitySchema, { id, label, device: {}, configurable: { state }, config: {} });
}

function camera(
  id: string,
  label: string,
  device: { state: DeviceState; error?: string; parent?: string },
  init: EntityInit = {},
): Entity {
  return create(EntitySchema, {
    id,
    label,
    device: { parent: SERVICE_ID, class: "camera", ...device },
    classification: cameraClassification(),
    ...init,
  });
}

const WEATHER_ID = "weather.service";

function sensorService(id: string, label: string): Entity {
  return create(EntitySchema, {
    id,
    label,
    device: {},
    configurable: {
      state: ConfigurableState.ConfigurableStateActive,
      supportedDeviceClasses: [{ class: "sensor", label: "Sensor" }],
    },
    config: {},
  });
}

function sensor(id: string, label: string, state: DeviceState, parent = WEATHER_ID): Entity {
  return create(EntitySchema, {
    id,
    label,
    device: { parent, class: "sensor", state },
    classification: sensorClassification(),
  });
}

function shown(entities: Entity[], isConnected = true) {
  const map = entityMap(entities);
  const groups = groupDevices(map);
  const sources = getSourcesState(groups, isConnected);

  return {
    badge: getMissionState(groups, isConnected),
    header: sources && { variant: sources.variant, label: sources.label },
    done: getDoneAction(sources),
    sections: getSourcesSections(getReportedSourceKinds(groups)).flatMap((section) => {
      const state = section.getState(groups, isConnected);

      if (!state) return [];

      const rows = section.getEntities(groups, map, isConnected).map((e) => {
        const { name, variant, label, error } = getSourceRow(e, groups, map, isConnected);

        return error ? { name, variant, label, error } : { name, variant, label };
      });

      return [{ title: section.title, variant: state.variant, rows }];
    }),
  };
}

const runningService = cameraService(ConfigurableState.ConfigurableStateActive);

const gateCamera = setUpCamera(
  "gate",
  "Gate camera",
  SERVICE_ID,
  ConfigurableState.ConfigurableStateActive,
);

describe("mission health agrees with the mission badge", () => {
  it("lists a camera whose device state alone failed", () => {
    const view = shown([
      runningService,
      camera("lobby", "Lobby camera", { state: DeviceState.DeviceStateFailed }),
    ]);

    expect(view.badge).toEqual({ severity: "alert", label: "Failed" });
    expect(view.header).toEqual({ variant: "alert", label: "Failed" });
    expect(view.done).toEqual({ label: "Proceed anyway", variant: "default" });
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "alert",
        rows: [
          { name: "Lobby camera", variant: "alert", label: "Failed" },
          { name: "Video service", variant: "alert", label: "Failed" },
        ],
      },
    ]);
  });

  it("shows a degraded webcam with the error its device sent", () => {
    const view = shown([
      runningService,
      camera("webcam", "Webcam", {
        state: DeviceState.DeviceStateDegraded,
        error: "no frames for 30 s",
      }),
    ]);

    expect(view.badge).toEqual({ severity: "pending", label: "Degraded" });
    expect(view.header).toEqual({ variant: "pending", label: "Degraded" });
    expect(view.done).toEqual({ label: "Proceed anyway", variant: "default" });
    expect(view.sections[0]?.rows).toEqual([
      { name: "Video service", variant: "pending", label: "Degraded" },
      { name: "Webcam", variant: "pending", label: "Degraded", error: "no frames for 30 s" },
    ]);
  });

  it("leaves out a camera with nothing to set up while it reports Pending, as the badge does", () => {
    const view = shown([
      runningService,
      camera("dock", "Dock camera", { state: DeviceState.DeviceStatePending }),
    ]);

    expect(view.badge).toEqual({ severity: "success" });
    expect(view.header).toEqual({ variant: "success", label: "Active" });
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "success",
        rows: [{ name: "Video service", variant: "success", label: "Active" }],
      },
    ]);
  });

  it("reads Starting and offers no calm Done while a service starts", () => {
    const view = shown([cameraService(ConfigurableState.ConfigurableStateStarting), gateCamera]);

    expect(view.badge).toEqual({ severity: "pending", label: "Starting" });
    expect(view.header).toEqual({ variant: "pending", label: "Starting" });
    expect(view.done).toEqual({ label: "Proceed anyway", variant: "default" });
  });

  it("shows an idle service as Inactive, not as starting", () => {
    const view = shown([
      runningService,
      gateCamera,
      otherService("relay.service", "Relay", ConfigurableState.ConfigurableStateInactive),
    ]);

    expect(view.badge).toBeUndefined();
    expect(view.header).toEqual({ variant: "default", label: "Inactive" });
    expect(view.done).toEqual({ label: "Done", variant: "default" });
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "success",
        rows: [
          { name: "Gate camera", variant: "success", label: "Active" },
          { name: "Video service", variant: "success", label: "Active" },
        ],
      },
      {
        title: "Other services",
        variant: "default",
        rows: [{ name: "Relay", variant: "default", label: "Inactive" }],
      },
    ]);
  });

  it("shows nothing as running once the connection is lost", () => {
    const view = shown([runningService, gateCamera], false);

    expect(view.badge).toBeUndefined();
    expect(view.header).toEqual({ variant: "default", label: "Active" });
    expect(view.done).toEqual({ label: "Done", variant: "default" });
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "default",
        rows: [
          { name: "Gate camera", variant: "default", label: "Active" },
          { name: "Video service", variant: "default", label: "Active" },
        ],
      },
    ]);
  });

  it("lists a failed discovered device whose service is missing under the source it reports", () => {
    const view = shown([
      camera(
        "orphan",
        "Orphan sensor",
        { state: DeviceState.DeviceStateFailed, parent: "gone.service" },
        { configurable: {} },
      ),
    ]);

    expect(view.badge).toEqual({ severity: "alert", label: "Failed" });
    expect(view.header).toEqual({ variant: "alert", label: "Failed" });
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "alert",
        rows: [{ name: "Orphan sensor", variant: "alert", label: "Failed" }],
      },
    ]);
  });

  it("reads an Active camera whose service is missing gray, ahead of the green rows", () => {
    const view = shown([
      runningService,
      gateCamera,
      camera("yard", "Yard camera", {
        state: DeviceState.DeviceStateActive,
        parent: "gone.service",
      }),
    ]);

    expect(view.badge).toBeUndefined();
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "default",
        rows: [
          { name: "Yard camera", variant: "default", label: "Active" },
          { name: "Gate camera", variant: "success", label: "Active" },
          { name: "Video service", variant: "success", label: "Active" },
        ],
      },
    ]);
  });

  it("reads an Active device without a service gray in its row as on its card", () => {
    const sensor = camera(
      "sensor",
      "Field sensor",
      { state: DeviceState.DeviceStateActive, parent: "gone.service" },
      { classification: undefined },
    );

    const view = shown([runningService, gateCamera, sensor]);

    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "success",
        rows: [
          { name: "Gate camera", variant: "success", label: "Active" },
          { name: "Video service", variant: "success", label: "Active" },
        ],
      },
      {
        title: "Without a service",
        variant: "default",
        rows: [{ name: "Field sensor", variant: "default", label: "Active" }],
      },
    ]);
    expect(view.sections[1]?.rows[0]?.variant).toBe(getOwnState(sensor, false).variant);
  });

  it("shows the reason a camera sent only in its device error", () => {
    const view = shown([
      runningService,
      camera(
        "yard",
        "Yard camera",
        { state: DeviceState.DeviceStateActive, error: "401 unauthorized" },
        { config: {}, configurable: { state: ConfigurableState.ConfigurableStateFailed } },
      ),
    ]);

    expect(view.badge).toEqual({ severity: "alert", label: "Failed" });
    expect(view.sections[0]?.rows).toEqual([
      { name: "Video service", variant: "alert", label: "Failed" },
      { name: "Yard camera", variant: "alert", label: "Failed", error: "401 unauthorized" },
    ]);
  });

  it("orders a service row by the state its tile shows", () => {
    const view = shown([
      runningService,
      setUpCamera("lobby", "Lobby camera", SERVICE_ID, ConfigurableState.ConfigurableStateStarting),
      camera("webcam", "Webcam", { state: DeviceState.DeviceStateDegraded }),
    ]);

    expect(view.sections[0]?.rows).toEqual([
      { name: "Video service", variant: "pending", label: "Degraded" },
      { name: "Webcam", variant: "pending", label: "Degraded" },
      { name: "Lobby camera", variant: "pending", label: "Starting" },
    ]);
  });

  it("names Conflict as the badge does and orders the rows by severity", () => {
    const view = shown([
      cameraService(ConfigurableState.ConfigurableStateConflict),
      camera("lobby", "Lobby camera", { state: DeviceState.DeviceStateFailed }),
      gateCamera,
      otherService("relay.service", "Relay", ConfigurableState.ConfigurableStateStarting),
    ]);

    expect(view.badge).toEqual({ severity: "alert", label: "Conflict" });
    expect(view.header).toEqual({ variant: "alert", label: "Conflict" });
    expect(view.sections).toEqual([
      {
        title: "Electro Optical",
        variant: "alert",
        rows: [
          { name: "Video service", variant: "alert", label: "Conflict" },
          { name: "Lobby camera", variant: "alert", label: "Failed" },
          { name: "Gate camera", variant: "success", label: "Active" },
        ],
      },
      {
        title: "Other services",
        variant: "pending",
        rows: [{ name: "Relay", variant: "pending", label: "Starting" }],
      },
    ]);
  });

  it("offers a green Done only when every source runs", () => {
    const view = shown([runningService, gateCamera]);

    expect(view.badge).toEqual({ severity: "success" });
    expect(view.header).toEqual({ variant: "success", label: "Active" });
    expect(view.done).toEqual({ label: "Done", variant: "success" });
  });

  it("lists a failing sensor that gives no kind under Sensor, not under Other services", () => {
    const view = shown([
      runningService,
      gateCamera,
      sensorService(WEATHER_ID, "Weather station"),
      sensor("deck", "Deck hygrometer", DeviceState.DeviceStateActive),
      sensor("mast", "Mast anemometer", DeviceState.DeviceStateFailed),
    ]);

    expect(view.badge).toEqual({ severity: "alert", label: "Failed" });
    expect(view.header).toEqual({ variant: "alert", label: "Failed" });
    expect(view.sections.map(({ title }) => title)).toEqual(["Electro Optical", "Sensor"]);
    expect(view.sections[1]).toEqual({
      title: "Sensor",
      variant: "alert",
      rows: [
        { name: "Mast anemometer", variant: "alert", label: "Failed" },
        { name: "Weather station", variant: "alert", label: "Failed" },
        { name: "Deck hygrometer", variant: "success", label: "Active" },
      ],
    });
  });

  it("shows a service with a camera and a sensor under both", () => {
    const view = shown([
      sensorService("mast.service", "Harbour mast"),
      camera("mast-cam", "Mast camera", {
        state: DeviceState.DeviceStateActive,
        parent: "mast.service",
      }),
      sensor("mast-wind", "Mast wind vane", DeviceState.DeviceStateFailed, "mast.service"),
    ]);

    expect(view.badge).toEqual({ severity: "alert", label: "Failed" });
    expect(view.sections.map(({ title }) => title)).toEqual(["Electro Optical", "Sensor"]);
  });
});

describe("names of devices that share a class", () => {
  it("lists each camera by its own name, not the class label its service gives it", () => {
    const classLabelled = (id: string, label: string) =>
      camera(
        id,
        label,
        { state: DeviceState.DeviceStateActive },
        {
          configurable: { label: "Camera", state: ConfigurableState.ConfigurableStateActive },
          config: {},
        },
      );

    const view = shown([
      runningService,
      classLabelled("north", "North gate camera"),
      classLabelled("dock", "Dock camera"),
    ]);

    expect(view.sections[0]?.rows.map((row) => row.name).sort()).toEqual([
      "Dock camera",
      "North gate camera",
      "Video service",
    ]);
  });
});

describe("computeStatic", () => {
  it("lists layout names from mission pack, sorted", () => {
    const result = computeStatic(pack({ layouts: { watch: "{}", default: "{}" } }), "0.1.0");

    expect(result.layoutNames).toEqual(["default", "watch"]);
  });

  it("reports warn on version mismatch", () => {
    const result = computeStatic(pack({ packVersion: "0.2.0" }), "0.1.0");

    expect(result.version).toEqual({ status: "warn", pack: "0.2.0", engine: "0.1.0" });
  });

  it("reports ok on version match", () => {
    expect(computeStatic(pack({ packVersion: "0.1.0" }), "0.1.0").version.status).toBe("ok");
  });

  it("reports artifact count and human-readable total size", () => {
    const result = computeStatic(
      pack({ artifactCount: 3, artifactTotalSize: 12_500_000n }),
      "0.1.0",
    );

    expect(result.artifacts).toEqual({ count: 3, size: "12.5 MB" });
  });

  it("defaults to 0 / 0 B when the pack records no artifacts", () => {
    expect(computeStatic(pack(), "0.1.0").artifacts).toEqual({ count: 0, size: "0 B" });
  });
});

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1500)).toBe("1.5 kB");
    expect(formatBytes(5_000_000)).toBe("5.0 MB");
    expect(formatBytes(3_000_000_000)).toBe("3.0 GB");
  });
});

describe("the node in mission health", () => {
  function node(state: DeviceState, config: boolean, error?: string): Entity {
    return create(EntitySchema, {
      id: "node.7c2e",
      label: "Relay host",
      device: { category: "Network", state, error, node: { hostname: "relay-host" } },
      config: config ? {} : undefined,
    });
  }

  it("lists a failed node without a config and offers no calm Done", () => {
    const view = shown([node(DeviceState.DeviceStateFailed, false, "disk full")]);

    expect(view.done).toEqual({ label: "Proceed anyway", variant: "default" });
    expect(view.sections).toEqual([
      {
        title: "Other services",
        variant: "alert",
        rows: [{ name: "Relay host", variant: "alert", label: "Failed", error: "disk full" }],
      },
    ]);
  });

  it("lists the devices of a healthy node with a config, not the node itself", () => {
    const adapter = create(EntitySchema, {
      id: "usb-1",
      label: "USB adapter",
      device: { parent: "node.7c2e", state: DeviceState.DeviceStateActive },
    });

    const view = shown([node(DeviceState.DeviceStateActive, true), adapter]);

    expect(view.sections).toEqual([
      {
        title: "Other services",
        variant: "success",
        rows: [{ name: "USB adapter", variant: "success", label: "Active" }],
      },
    ]);
  });
});
