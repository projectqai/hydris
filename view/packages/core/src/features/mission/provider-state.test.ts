import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Entity } from "@projectqai/proto/world";
import {
  ConfigurableComponentSchema,
  ConfigurableState,
  DeviceComponentSchema,
  DeviceState,
  EntitySchema,
  LinkComponentSchema,
  LinkStatus,
} from "@projectqai/proto/world";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntityInit } from "../../storybook/entities";
import { cameraClassification, entityMap, sensorClassification } from "../../storybook/entities";
import {
  getDeviceState,
  getMissionState,
  getOtherServicesState,
  getOwnState,
  getServiceRows,
  getServiceState,
  getSourceRowState,
  getSourcesState,
  getSourceState,
  getStateLabel,
  getWithoutServiceState,
} from "./provider-state";
import type { Service } from "./sources";
import { getOtherServices, getSourceServices, groupDevices, inRollup } from "./sources";

const CAMERA_SERVICE_ID = "axis.service";

function cameraService(
  state: ConfigurableState,
  deviceState = DeviceState.DeviceStateActive,
): Service {
  const root = create(EntitySchema, {
    id: CAMERA_SERVICE_ID,
    label: "AXIS Cameras",
    configurable: { supportedDeviceClasses: [{ class: "camera", label: "AXIS Camera" }], state },
    config: {},
  });

  return {
    ...root,
    device: create(DeviceComponentSchema, { category: "Cameras", state: deviceState }),
  };
}

function cameraServiceNeverSetUp(): Service {
  return { ...cameraService(ConfigurableState.ConfigurableStateInactive), config: undefined };
}

function device(id: string, parent: string, init: EntityInit = {}): Entity {
  return create(EntitySchema, {
    id,
    device: { parent, class: "camera", category: "Cameras", state: DeviceState.DeviceStateActive },
    ...init,
  });
}

function discoveredCamera(
  id: string,
  parent = CAMERA_SERVICE_ID,
  state = DeviceState.DeviceStatePending,
): Entity {
  return device(id, parent, {
    device: { parent, class: "camera", category: "Cameras", state },
    classification: cameraClassification(),
    configurable: {},
  });
}

function cameraWithoutSetup(
  id: string,
  deviceState: DeviceState,
  parent = CAMERA_SERVICE_ID,
): Entity {
  return device(id, parent, {
    device: { parent, class: "camera", category: "Cameras", state: deviceState },
    classification: cameraClassification(),
  });
}

function setUpCamera(
  id: string,
  state: ConfigurableState,
  parent = CAMERA_SERVICE_ID,
  deviceState = DeviceState.DeviceStateActive,
): Entity {
  return device(id, parent, {
    device: { parent, class: "camera", category: "Cameras", state: deviceState },
    classification: cameraClassification(),
    config: { value: { host: "10.0.4.17" }, version: 2n },
    configurable: { state },
    camera: { streams: [{ url: `rtsp://10.0.4.17/${id}` }] },
  });
}

function service(id: string, state: ConfigurableState): Entity {
  return create(EntitySchema, { id, device: {}, configurable: { state }, config: {} });
}

const LINK_SERVICE_ID = "link.service";

const linkService = create(EntitySchema, {
  id: LINK_SERVICE_ID,
  device: {},
  configurable: { supportedDeviceClasses: [{ class: "endpoint", label: "Link Endpoint" }] },
});

function endpoint(id: string, state: ConfigurableState): Entity {
  return device(id, LINK_SERVICE_ID, {
    device: { parent: LINK_SERVICE_ID, class: "endpoint", state: DeviceState.DeviceStatePending },
    config: { value: { address: "udp://10.0.4.20:14550" }, version: 1n },
    configurable: { state },
  });
}

function cameraServiceWithError(state: ConfigurableState, error: string): Service {
  const root = cameraService(state);

  return {
    ...root,
    configurable: create(ConfigurableComponentSchema, {
      state,
      error,
      supportedDeviceClasses: root.configurable?.supportedDeviceClasses,
    }),
  };
}

function degradedWebcam(id: string, error: string): Entity {
  return device(id, CAMERA_SERVICE_ID, {
    device: {
      parent: CAMERA_SERVICE_ID,
      class: "camera",
      state: DeviceState.DeviceStateDegraded,
      error,
    },
    classification: cameraClassification(),
  });
}

function groupsOf(entities: Entity[]) {
  return groupDevices(entityMap(entities));
}

function serviceOf(entities: Entity[], id: string) {
  const services = groupsOf(entities).services.get(id);

  if (!services) throw new Error(`${id} is no service`);

  return services;
}

function stateOf(root: Service, others: Entity[] = [], isConnected = true) {
  return getServiceState(serviceOf([root, ...others], root.id), isConnected);
}

function variantOf(root: Service, others: Entity[] = []) {
  return stateOf(root, others).variant;
}

function ownStateOf(
  configurable: ConfigurableState | undefined,
  deviceState: DeviceState,
  configured = true,
  isConnected = true,
) {
  return getOwnState(
    create(EntitySchema, {
      id: "cam-1",
      device: { parent: CAMERA_SERVICE_ID, class: "camera", state: deviceState },
      configurable: configurable === undefined ? undefined : { state: configurable },
      config: configured ? { value: { host: "10.0.4.17" }, version: 1n } : undefined,
      camera: { streams: [] },
    }),
    isConnected,
  );
}

describe("getServiceState", () => {
  it("ignores a discovered camera that nobody has set up", () => {
    expect(
      stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [
        discoveredCamera("cam-5"),
      ]),
    ).toEqual({ variant: "success", label: "Active" });
  });

  it("raises alert when a discovered camera reports a failure before setup", () => {
    const failed = discoveredCamera("cam-5", CAMERA_SERVICE_ID, DeviceState.DeviceStateFailed);

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [failed])).toEqual({
      variant: "alert",
      label: "Failed",
    });
  });

  it("counts a device with nothing to set up that is not a camera", () => {
    const sensor = device("sensor-1", CAMERA_SERVICE_ID, {
      device: {
        parent: CAMERA_SERVICE_ID,
        class: "sensor",
        state: DeviceState.DeviceStateDegraded,
      },
    });

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [sensor])).toEqual({
      variant: "pending",
      label: "Degraded",
    });
  });

  it("raises alert when a camera with nothing to set up fails", () => {
    const failed = cameraWithoutSetup("webcam-1", DeviceState.DeviceStateFailed);

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [failed])).toEqual({
      variant: "alert",
      label: "Failed",
    });
  });

  it("ignores devices under another service", () => {
    const failed = setUpCamera(
      "cam-7",
      ConfigurableState.ConfigurableStateFailed,
      "simcam.service",
    );

    expect(variantOf(cameraService(ConfigurableState.ConfigurableStateActive), [failed])).toBe(
      "success",
    );
  });

  it("reads pending while the service is starting", () => {
    expect(variantOf(cameraService(ConfigurableState.ConfigurableStateStarting))).toBe("pending");
  });

  it("reads default, not dashed, while the service is inactive", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateInactive);

    expect(
      stateOf(root, [setUpCamera("cam-3", ConfigurableState.ConfigurableStateActive)]),
    ).toEqual({ variant: "default", label: "Inactive" });
  });

  it("names the failed camera's state when it drives the look", () => {
    const cameras = [
      setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed),
    ];

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), cameras)).toEqual({
      variant: "alert",
      label: "Failed",
    });
  });

  it("names a set-up camera's configurable state when it drives the look", () => {
    const starting = setUpCamera(
      "cam-8",
      ConfigurableState.ConfigurableStateStarting,
      CAMERA_SERVICE_ID,
      DeviceState.DeviceStateFailed,
    );

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [starting])).toEqual({
      variant: "pending",
      label: "Starting",
    });
  });

  it("names the service's own state when it drives the look", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateStarting);

    expect(
      stateOf(root, [setUpCamera("cam-3", ConfigurableState.ConfigurableStateActive)]),
    ).toEqual({ variant: "pending", label: "Starting" });
  });

  it("names the service's own state while the group is calm", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateScheduled);

    expect(
      stateOf(root, [setUpCamera("cam-3", ConfigurableState.ConfigurableStateActive)]),
    ).toEqual({ variant: "success", label: "Scheduled" });
  });

  it("shows no state for a service that was never set up", () => {
    expect(stateOf(cameraServiceNeverSetUp())).toEqual({ variant: "default" });
  });

  it("names a failing camera beneath a service that was never set up, as the rollup does", () => {
    const failed = cameraWithoutSetup("webcam-1", DeviceState.DeviceStateFailed);

    expect(stateOf(cameraServiceNeverSetUp(), [failed])).toEqual({
      variant: "alert",
      label: "Failed",
    });
  });

  it("names a failing set-up camera beneath a service that was never set up, with its error", () => {
    const failing = withError(
      setUpCamera("cam-9", ConfigurableState.ConfigurableStateFailed),
      "stream refused",
    );

    expect(stateOf(cameraServiceNeverSetUp(), [discoveredCamera("cam-3"), failing])).toEqual({
      variant: "alert",
      label: "Failed",
      error: "stream refused",
    });
  });

  it("reads a running set-up camera beneath a service that was never set up as running", () => {
    const running = setUpCamera("cam-9", ConfigurableState.ConfigurableStateActive);

    expect(stateOf(cameraServiceNeverSetUp(), [running])).toEqual({
      variant: "success",
      label: "Active",
    });
  });

  it("raises alert when the service itself fails", () => {
    expect(variantOf(cameraService(ConfigurableState.ConfigurableStateFailed))).toBe("alert");
  });

  it("raises alert when a set-up camera is in conflict", () => {
    const conflicted = setUpCamera("cam-6", ConfigurableState.ConfigurableStateConflict);

    expect(variantOf(cameraService(ConfigurableState.ConfigurableStateActive), [conflicted])).toBe(
      "alert",
    );
  });

  it("raises a device failure on a running set-up camera", () => {
    const running = setUpCamera(
      "cam-4",
      ConfigurableState.ConfigurableStateActive,
      CAMERA_SERVICE_ID,
      DeviceState.DeviceStateFailed,
    );

    expect(variantOf(cameraService(ConfigurableState.ConfigurableStateActive), [running])).toBe(
      "alert",
    );
  });

  it("stays calm while a running set-up camera still reports a pending device", () => {
    const running = setUpCamera(
      "cam-8",
      ConfigurableState.ConfigurableStateActive,
      CAMERA_SERVICE_ID,
      DeviceState.DeviceStatePending,
    );

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [running])).toEqual({
      variant: "success",
      label: "Active",
    });
  });

  it("raises a degraded device state on a service that has a configurable", () => {
    const root = cameraService(
      ConfigurableState.ConfigurableStateActive,
      DeviceState.DeviceStateDegraded,
    );

    expect(variantOf(root, [setUpCamera("cam-3", ConfigurableState.ConfigurableStateActive)])).toBe(
      "pending",
    );
  });

  it("reads an active service with an unset device state as running", () => {
    const root = cameraService(
      ConfigurableState.ConfigurableStateActive,
      DeviceState.DeviceStatePending,
    );

    expect(stateOf(root)).toEqual({ variant: "success", label: "Active" });
  });

  it("ends the walk when parent links form a cycle", () => {
    const first = device("loop-1", "loop-2", { config: {} });
    const second = device("loop-2", "loop-1", { config: {} });

    expect(
      variantOf(cameraService(ConfigurableState.ConfigurableStateActive), [first, second]),
    ).toBe("success");
  });

  it("lets a failed camera outrank a starting service", () => {
    const failed = setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed);

    expect(variantOf(cameraService(ConfigurableState.ConfigurableStateStarting), [failed])).toBe(
      "alert",
    );
  });

  it("names a conflict over a failure that comes before it", () => {
    const cameras = [
      setUpCamera("cam-1", ConfigurableState.ConfigurableStateFailed),
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateConflict),
    ];

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), cameras)).toEqual({
      variant: "alert",
      label: "Conflict",
    });
  });

  it("names a camera's conflict over the service's own failure", () => {
    const conflicted = setUpCamera("cam-6", ConfigurableState.ConfigurableStateConflict);

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateFailed), [conflicted])).toEqual(
      {
        variant: "alert",
        label: "Conflict",
      },
    );
  });

  it("names a degraded camera over pending and starting ones before it", () => {
    const cameras = [
      cameraWithoutSetup("webcam-1", DeviceState.DeviceStatePending),
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateStarting),
      cameraWithoutSetup("webcam-3", DeviceState.DeviceStateDegraded),
    ];

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), cameras)).toEqual({
      variant: "pending",
      label: "Degraded",
    });
  });

  it("names a starting camera over a pending one before it", () => {
    const cameras = [
      cameraWithoutSetup("webcam-1", DeviceState.DeviceStatePending),
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateStarting),
    ];

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), cameras)).toEqual({
      variant: "pending",
      label: "Starting",
    });
  });

  it("drops the running look while not connected and keeps the word", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateActive);
    const cameras = [setUpCamera("cam-3", ConfigurableState.ConfigurableStateActive)];

    expect(stateOf(root, cameras, false)).toEqual({ variant: "default", label: "Active" });
  });

  it("keeps naming a failed camera while not connected", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateActive);
    const cameras = [setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed)];

    expect(stateOf(root, cameras, false)).toEqual({ variant: "alert", label: "Failed" });
  });

  it("carries the error of the most severe item, not of a milder one before it", () => {
    const root = cameraServiceWithError(ConfigurableState.ConfigurableStateStarting, "warming up");

    const cameras = [
      degradedWebcam("webcam-1", "low frame rate"),
      withError(setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed), "stream refused"),
    ];

    expect(stateOf(root, cameras)).toEqual({
      variant: "alert",
      label: "Failed",
      error: "stream refused",
    });
  });

  it("carries the service's own error when the service names the tile", () => {
    const root = cameraServiceWithError(
      ConfigurableState.ConfigurableStateFailed,
      "license expired",
    );

    expect(stateOf(root, [degradedWebcam("webcam-1", "low frame rate")])).toEqual({
      variant: "alert",
      label: "Failed",
      error: "license expired",
    });
  });
});

const DEVICE_COLUMNS = [
  DeviceState.DeviceStatePending,
  DeviceState.DeviceStateActive,
  DeviceState.DeviceStateFailed,
  DeviceState.DeviceStateDegraded,
];

// rows are the configurable state, columns follow DEVICE_COLUMNS
const SHOWN_STATE: [ConfigurableState, string[]][] = [
  [ConfigurableState.ConfigurableStateConflict, ["Conflict", "Conflict", "Conflict", "Conflict"]],
  [ConfigurableState.ConfigurableStateFailed, ["Failed", "Failed", "Failed", "Failed"]],
  [ConfigurableState.ConfigurableStateStarting, ["Starting", "Starting", "Starting", "Starting"]],
  [ConfigurableState.ConfigurableStateInactive, ["Inactive", "Inactive", "Inactive", "Inactive"]],
  [ConfigurableState.ConfigurableStateActive, ["Active", "Active", "Failed", "Degraded"]],
  [
    ConfigurableState.ConfigurableStateScheduled,
    ["Scheduled", "Scheduled", "Scheduled", "Scheduled"],
  ],
];

const SHOWN_STATE_CELLS = SHOWN_STATE.flatMap(([configurable, labels]) =>
  labels.map((label, column) => {
    const device = DEVICE_COLUMNS[column]!;

    return {
      configurable,
      device,
      label,
      name: `${ConfigurableState[configurable]} with ${DeviceState[device]} shows ${label}`,
    };
  }),
);

describe("the state a set-up entity shows", () => {
  it.each(SHOWN_STATE_CELLS)("$name", ({ configurable, device, label }) => {
    expect(ownStateOf(configurable, device).label).toBe(label);
    expect(stateOf(cameraService(configurable, device)).label).toBe(label);
  });

  it("carries the device's error when the device state wins", () => {
    const camera = device("cam-3", CAMERA_SERVICE_ID, {
      device: {
        parent: CAMERA_SERVICE_ID,
        class: "camera",
        state: DeviceState.DeviceStateFailed,
        error: "capture lost",
      },
      config: { value: { host: "10.0.4.19" }, version: 3n },
      configurable: { state: ConfigurableState.ConfigurableStateActive },
    });

    expect(getOwnState(camera, true)).toEqual({
      variant: "alert",
      label: "Failed",
      error: "capture lost",
    });
  });
});

describe("getOwnState", () => {
  it("carries the error of the component that names a set-up camera's state", () => {
    const camera = device("cam-2", CAMERA_SERVICE_ID, {
      device: {
        parent: CAMERA_SERVICE_ID,
        class: "camera",
        state: DeviceState.DeviceStateFailed,
        error: "stale probe",
      },
      config: { value: { host: "10.0.4.17" }, version: 2n },
      configurable: { state: ConfigurableState.ConfigurableStateFailed, error: "stream refused" },
    });

    expect(getOwnState(camera, true)).toEqual({
      variant: "alert",
      label: "Failed",
      error: "stream refused",
    });
  });

  it("reads a set-up camera as running while its device still reports pending", () => {
    expect(
      ownStateOf(ConfigurableState.ConfigurableStateActive, DeviceState.DeviceStatePending),
    ).toEqual({ variant: "success", label: "Active" });
  });

  it("reads a discovered camera by its unset configurable, calm", () => {
    expect(
      ownStateOf(
        ConfigurableState.ConfigurableStateInactive,
        DeviceState.DeviceStatePending,
        false,
      ),
    ).toEqual({ variant: "default", label: "Inactive" });
  });

  it("shows the look of a failure a discovered camera reports before setup", () => {
    expect(
      ownStateOf(ConfigurableState.ConfigurableStateInactive, DeviceState.DeviceStateFailed, false),
    ).toEqual({ variant: "alert", label: "Failed" });
  });

  it("reads a camera that reports active before setup as not running", () => {
    expect(
      ownStateOf(ConfigurableState.ConfigurableStateInactive, DeviceState.DeviceStateActive, false),
    ).toEqual({ variant: "default", label: "Inactive" });
  });

  it("reads a camera with nothing to set up by its device state, with its normal look", () => {
    expect(ownStateOf(undefined, DeviceState.DeviceStateFailed, false)).toEqual({
      variant: "alert",
      label: "Failed",
    });
  });

  it("reads a set-up camera by its configurable state even when its device failed", () => {
    expect(
      ownStateOf(ConfigurableState.ConfigurableStateStarting, DeviceState.DeviceStateFailed),
    ).toEqual({ variant: "pending", label: "Starting" });
  });

  it("raises alert when a set-up camera's configurable is in conflict", () => {
    expect(
      ownStateOf(ConfigurableState.ConfigurableStateConflict, DeviceState.DeviceStateActive),
    ).toEqual({ variant: "alert", label: "Conflict" });
  });

  it("reads an inactive camera calm even while its device reports active", () => {
    expect(
      ownStateOf(ConfigurableState.ConfigurableStateInactive, DeviceState.DeviceStateActive),
    ).toEqual({ variant: "default", label: "Inactive" });
  });

  it("drops the running look while not connected and keeps the word", () => {
    expect(
      ownStateOf(
        ConfigurableState.ConfigurableStateActive,
        DeviceState.DeviceStateActive,
        true,
        false,
      ),
    ).toEqual({ variant: "default", label: "Active" });
  });

  it("keeps a failure while not connected", () => {
    expect(
      ownStateOf(
        ConfigurableState.ConfigurableStateFailed,
        DeviceState.DeviceStateActive,
        true,
        false,
      ),
    ).toEqual({ variant: "alert", label: "Failed" });
  });
});

function rowsOf(entities: Entity[], id = CAMERA_SERVICE_ID) {
  return getServiceRows(serviceOf(entities, id), true).map(({ device, state }) => [
    device.id,
    state.variant,
    state.label,
  ]);
}

const NETWORK_ID = "gauge.service";

type NodeInit = { link?: LinkStatus; pump?: DeviceState };

function node(id: string, init: NodeInit = {}): Entity[] {
  const { link = LinkStatus.LinkStatusConnected, pump = DeviceState.DeviceStateActive } = init;

  return [
    create(EntitySchema, {
      id,
      device: { parent: NETWORK_ID, state: DeviceState.DeviceStateActive },
      configurable: {},
      link: { status: link },
      sensor: {},
      classification: sensorClassification(),
    }),
    create(EntitySchema, {
      id: `${id}.rain`,
      label: "Rain sensor",
      device: { parent: id, state: DeviceState.DeviceStateActive },
    }),
    create(EntitySchema, {
      id: `${id}.pump`,
      device: { parent: id, state: pump },
      configurable: {},
    }),
  ];
}

function nodes(inits: Record<string, NodeInit> = {}): Entity[] {
  return [
    service(NETWORK_ID, ConfigurableState.ConfigurableStateActive),
    ...["gauge-01", "gauge-02", "gauge-03"].flatMap((id) => node(id, inits[id])),
  ];
}

describe("getServiceRows", () => {
  it("gives each direct child one row with its own word while everything below is calm", () => {
    expect(rowsOf(nodes(), NETWORK_ID)).toEqual([
      ["gauge-01", "default", "Inactive"],
      ["gauge-02", "default", "Inactive"],
      ["gauge-03", "default", "Inactive"],
    ]);
  });

  it("names a node by the failure of a device below it", () => {
    const rows = rowsOf(nodes({ "gauge-03": { pump: DeviceState.DeviceStateFailed } }), NETWORK_ID);

    expect(rows).toEqual([
      ["gauge-03", "alert", "Failed"],
      ["gauge-01", "default", "Inactive"],
      ["gauge-02", "default", "Inactive"],
    ]);
  });

  it("names a node by its lost link", () => {
    const rows = rowsOf(nodes({ "gauge-02": { link: LinkStatus.LinkStatusLost } }), NETWORK_ID);

    expect(rows[0]).toEqual(["gauge-02", "alert", "Lost"]);
  });

  it("keeps a child's own failure over a milder raised word below it", () => {
    const rows = rowsOf([
      cameraService(ConfigurableState.ConfigurableStateActive),
      setUpCamera("cam-1", ConfigurableState.ConfigurableStateFailed),
      cameraWithoutSetup("cam-1.ch-2", DeviceState.DeviceStateDegraded, "cam-1"),
    ]);

    expect(rows).toEqual([["cam-1", "alert", "Failed"]]);
  });

  it("leaves a row alone for a device below that is out of the count", () => {
    const rows = rowsOf([
      cameraService(ConfigurableState.ConfigurableStateActive),
      setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
      cameraWithoutSetup("cam-1.ch-2", DeviceState.DeviceStatePending, "cam-1"),
    ]);

    expect(rows).toEqual([["cam-1", "success", "Active"]]);
  });

  it("puts the most severe row first, then orders by label", () => {
    const rows = rowsOf([
      cameraService(ConfigurableState.ConfigurableStateActive),
      { ...cameraWithoutSetup("webcam-a", DeviceState.DeviceStateActive), label: "Delta" },
      { ...setUpCamera("cam-b", ConfigurableState.ConfigurableStateStarting), label: "Charlie" },
      { ...cameraWithoutSetup("webcam-c", DeviceState.DeviceStateActive), label: "Alpha" },
      { ...setUpCamera("cam-d", ConfigurableState.ConfigurableStateActive), label: "Bravo" },
      cameraWithoutSetup("cam-d.ch-1", DeviceState.DeviceStateFailed, "cam-d"),
    ]);

    expect(rows.map(([id]) => id)).toEqual(["cam-d", "cam-b", "webcam-c", "webcam-a"]);
  });
});

describe("rows and word of a device below its service", () => {
  const entities = [
    ...nodes(),
    create(EntitySchema, {
      id: "gauge-02.pump.motor",
      label: "Motor",
      device: { parent: "gauge-02.pump", state: DeviceState.DeviceStateDegraded },
    }),
  ];

  const node02 = entities.find((e) => e.id === "gauge-02")!;
  const below = entities.filter((e) => e.id.startsWith("gauge-02."));

  it("gives each child of the node one row, raised by what lies below that child", () => {
    const rows = getServiceRows({ serviceId: node02.id, devices: below }, true).map(
      ({ device, state }) => [device.id, state.variant, state.label],
    );

    expect(rows).toEqual([
      ["gauge-02.pump", "pending", "Degraded"],
      ["gauge-02.rain", "success", "Active"],
    ]);
  });

  it("names the node by the worst raised word anywhere below it", () => {
    expect(getDeviceState(node02, below, true)).toMatchObject({
      variant: "pending",
      label: "Degraded",
    });
  });
});

function missionStateOf(entities: Entity[], isConnected = true) {
  return getMissionState(groupsOf(entities), isConnected);
}

const runningCameras = [
  cameraService(ConfigurableState.ConfigurableStateActive),
  setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
];

const RUNNING = { severity: "success" };

describe("getMissionState", () => {
  it("reads success while connected and every set-up service runs", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
        service("tracker.service", ConfigurableState.ConfigurableStateScheduled),
      ]),
    ).toEqual(RUNNING);
  });

  it("shows no state while a set-up service rests", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
        service("tracker.service", ConfigurableState.ConfigurableStateInactive),
      ]),
    ).toBeUndefined();
  });

  it("shows no state while not connected, even when every service last ran", () => {
    expect(
      missionStateOf([cameraService(ConfigurableState.ConfigurableStateActive)], false),
    ).toBeUndefined();
  });

  it("keeps naming a failure while not connected", () => {
    expect(
      missionStateOf([cameraService(ConfigurableState.ConfigurableStateFailed)], false),
    ).toEqual({
      severity: "alert",
      label: "Failed",
    });
  });

  it("shows no state when only devices without a service run", () => {
    const sensor = sensorWithoutService("sensor-1", DeviceState.DeviceStateActive);
    const entities = [cameraServiceNeverSetUp(), sensor];

    expect(getSourcesState(groupsOf(entities), true)).toMatchObject({ variant: "default" });
    expect(missionStateOf(entities)).toBeUndefined();
  });

  it("drops the running look while a device without a service runs or rests beside running services", () => {
    const running = sensorWithoutService("sensor-1", DeviceState.DeviceStateActive);

    const resting = device("sensor-2", "sensor.service", {
      device: { parent: "sensor.service", class: "sensor" },
      config: {},
      configurable: { state: ConfigurableState.ConfigurableStateInactive },
    });

    expect(missionStateOf(runningCameras)).toEqual(RUNNING);
    expect(missionStateOf([...runningCameras, running])).toBeUndefined();
    expect(missionStateOf([...runningCameras, resting])).toBeUndefined();
  });

  it("names a failing service that offers no cameras", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        service("tracker.service", ConfigurableState.ConfigurableStateFailed),
      ]),
    ).toEqual({ severity: "alert", label: "Failed" });
  });

  it("reads pending when the worst state is a starting service", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        service("tracker.service", ConfigurableState.ConfigurableStateStarting),
      ]),
    ).toEqual({ severity: "pending", label: "Starting" });
  });

  it("names a failed camera nested under another device of a set-up service", () => {
    const recorder = device("recorder-1", CAMERA_SERVICE_ID, { config: {} });

    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        recorder,
        setUpCamera("cam-9", ConfigurableState.ConfigurableStateFailed, recorder.id),
      ]),
    ).toEqual({ severity: "alert", label: "Failed" });
  });

  it("ignores a service that was never set up and the devices beneath it that await setup", () => {
    expect(
      missionStateOf([
        {
          ...service("tracker.service", ConfigurableState.ConfigurableStateFailed),
          config: undefined,
        },
        cameraServiceNeverSetUp(),
        discoveredCamera("cam-3"),
      ]),
    ).toBeUndefined();
  });

  it("names a degraded device with nothing to set up beneath a service that was never set up", () => {
    expect(
      missionStateOf([
        cameraServiceNeverSetUp(),
        cameraWithoutSetup("webcam-1", DeviceState.DeviceStateDegraded),
      ]),
    ).toEqual({ severity: "pending", label: "Degraded" });
  });

  it("names a failing set-up endpoint beneath a service that was never set up", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
        linkService,
        endpoint("link-2", ConfigurableState.ConfigurableStateFailed),
      ]),
    ).toEqual({ severity: "alert", label: "Failed" });
  });

  it("stays running while a set-up endpoint beneath a service that was never set up runs", () => {
    expect(
      missionStateOf([
        ...runningCameras,
        linkService,
        endpoint("link-2", ConfigurableState.ConfigurableStateActive),
      ]),
    ).toEqual(RUNNING);
  });

  it("ignores a discovered device that nobody has set up", () => {
    expect(missionStateOf([...runningCameras, discoveredCamera("cam-5")])).toEqual(RUNNING);
  });

  it("names a failed set-up device whose service is not in the world", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        setUpCamera("cam-7", ConfigurableState.ConfigurableStateFailed, "gone.service"),
      ]),
    ).toEqual({ severity: "alert", label: "Failed" });
  });

  it("keeps a pending device with nothing to set up whose service is not in the world calm", () => {
    const sensor = sensorWithoutService("sensor-1", DeviceState.DeviceStatePending);

    expect(missionStateOf([...runningCameras, sensor])).toEqual(RUNNING);
  });

  it("keeps a device without a service calm while it awaits setup with a pending state", () => {
    const offered = device("sensor-2", "sensor.service", {
      device: { parent: "sensor.service", class: "sensor", state: DeviceState.DeviceStatePending },
      configurable: { state: ConfigurableState.ConfigurableStateFailed },
    });

    expect(missionStateOf([...runningCameras, offered])).toEqual(RUNNING);
  });

  it("names a device without a service that reports a failure before setup", () => {
    const offered = device("sensor-2", "sensor.service", {
      device: { parent: "sensor.service", class: "sensor", state: DeviceState.DeviceStateFailed },
      configurable: {},
    });

    expect(
      missionStateOf([cameraService(ConfigurableState.ConfigurableStateActive), offered]),
    ).toEqual({
      severity: "alert",
      label: "Failed",
    });
  });

  it("names a discovered camera that reports a failure before setup", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        discoveredCamera("cam-5", CAMERA_SERVICE_ID, DeviceState.DeviceStateFailed),
      ]),
    ).toEqual({ severity: "alert", label: "Failed" });
  });

  it("names a discovered camera that reports degraded before setup", () => {
    expect(
      missionStateOf([
        cameraService(ConfigurableState.ConfigurableStateActive),
        discoveredCamera("cam-5", CAMERA_SERVICE_ID, DeviceState.DeviceStateDegraded),
      ]),
    ).toEqual({ severity: "pending", label: "Degraded" });
  });

  it("keeps a discovered camera that reports active before setup out of the count", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateActive);
    const active = discoveredCamera("cam-5", CAMERA_SERVICE_ID, DeviceState.DeviceStateActive);

    expect(getSourcesState(groupsOf([root, active]), true)).toMatchObject({ devices: 0 });
  });

  it("names a failed device beneath a device whose service is not in the world", () => {
    const sensor = sensorWithoutService("sensor-1", DeviceState.DeviceStateActive);

    const heater = device("sensor-1.heater", sensor.id, {
      device: {
        parent: sensor.id,
        class: "heater",
        state: DeviceState.DeviceStateFailed,
        error: "element open circuit",
      },
    });

    const entities = [...runningCameras, sensor, heater];
    const named = { variant: "alert", label: "Failed", entityId: heater.id };

    expect(getWithoutServiceState(groupsOf(entities), true)).toEqual({
      ...named,
      services: 0,
      devices: 2,
    });
    expect(getSourcesState(groupsOf(entities), true)).toMatchObject(named);
    expect(missionStateOf(entities)).toEqual({ severity: "alert", label: "Failed" });
  });

  it("counts the cameras of a missing service once in Cameras, where they drop its running look", () => {
    const yard = cameraWithoutSetup("yard-cam", DeviceState.DeviceStateActive, "gone.service");
    const quay = cameraWithoutSetup("quay-cam", DeviceState.DeviceStateFailed, "gone.service");
    const calm = [...runningCameras, yard];
    const failing = [...calm, quay];
    const unvouched = { variant: "default", label: "Active", services: 1, devices: 2 };

    expect(getSourceState("electroOptical", groupsOf(calm), true)).toMatchObject(unvouched);
    expect(getServiceState(serviceOf(calm, "gone.service"), true)).toEqual({
      variant: "default",
      label: "Active",
    });
    expect(getSourceState("electroOptical", groupsOf(failing), true)).toMatchObject({
      variant: "alert",
      label: "Failed",
      entityId: quay.id,
      services: 1,
      devices: 3,
    });
    expect(getSourcesState(groupsOf(failing), true)).toMatchObject({ services: 1, devices: 3 });
    expect(getWithoutServiceState(groupsOf(failing), true)).toBeUndefined();
  });

  it("names a conflict over a failure in another service, in either order", () => {
    const failing = service("tracker.service", ConfigurableState.ConfigurableStateFailed);
    const starting = service("relay.service", ConfigurableState.ConfigurableStateStarting);

    const conflicted = [
      cameraService(ConfigurableState.ConfigurableStateActive),
      setUpCamera("cam-6", ConfigurableState.ConfigurableStateConflict),
    ];

    const conflict = { severity: "alert", label: "Conflict" };

    expect(missionStateOf([failing, ...conflicted, starting])).toEqual(conflict);
    expect(missionStateOf([...conflicted, failing, starting])).toEqual(conflict);
  });
});

const WEBCAM_SERVICE_ID = "webcam.service";

function webcam(id: string, state = DeviceState.DeviceStateActive): Entity {
  return device(id, WEBCAM_SERVICE_ID, {
    device: { parent: WEBCAM_SERVICE_ID, class: "camera", state },
    classification: cameraClassification(),
    camera: { streams: [] },
  });
}

function sensorWithoutService(id: string, state: DeviceState): Entity {
  return device(id, "sensor.service", {
    device: { parent: "sensor.service", class: "sensor", state },
  });
}

function withError(entity: Entity, error: string): Entity {
  const state = entity.configurable?.state ?? ConfigurableState.ConfigurableStateInactive;

  return { ...entity, configurable: create(ConfigurableComponentSchema, { state, error }) };
}

const tracker = service("tracker.service", ConfigurableState.ConfigurableStateActive);

const servedSources = [
  cameraService(ConfigurableState.ConfigurableStateActive),
  setUpCamera("cam-1", ConfigurableState.ConfigurableStateActive),
  setUpCamera("cam-2", ConfigurableState.ConfigurableStateActive),
  discoveredCamera("cam-3"),
  service(WEBCAM_SERVICE_ID, ConfigurableState.ConfigurableStateActive),
  webcam("webcam-1"),
  tracker,
];

const mixedSources = [
  ...servedSources,
  sensorWithoutService("sensor-1", DeviceState.DeviceStateActive),
];

describe("getSourcesState", () => {
  it("reads nothing while no service is set up and no device speaks without one", () => {
    expect(
      getSourcesState(groupsOf([cameraServiceNeverSetUp(), discoveredCamera("cam-3")]), true),
    ).toBeUndefined();
  });

  it("counts every device that speaks for a set-up service or has none", () => {
    expect(getSourcesState(groupsOf(mixedSources), true)).toMatchObject({
      variant: "default",
      label: "Active",
      services: 3,
      devices: 4,
    });
  });

  it("drops the running look while not connected and keeps the word", () => {
    expect(getSourcesState(groupsOf(servedSources), false)).toMatchObject({
      variant: "default",
      label: "Active",
    });
  });

  it("names the most severe item, not a milder one before it", () => {
    const starting = service("relay.service", ConfigurableState.ConfigurableStateStarting);
    const failing = setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed);

    expect(getSourcesState(groupsOf([starting, ...mixedSources, failing]), true)).toMatchObject({
      variant: "alert",
      label: "Failed",
      entityId: "cam-2",
    });
  });

  it("names a failed device without a service", () => {
    const lost = sensorWithoutService("sensor-2", DeviceState.DeviceStateFailed);

    expect(getSourcesState(groupsOf([...mixedSources, lost]), true)).toMatchObject({
      variant: "alert",
      label: "Failed",
      entityId: "sensor-2",
    });
  });

  it("names a failing set-up endpoint beneath a service that was never set up", () => {
    const failing = endpoint("link-2", ConfigurableState.ConfigurableStateFailed);

    expect(getSourcesState(groupsOf([...mixedSources, linkService, failing]), true)).toEqual({
      variant: "alert",
      label: "Failed",
      entityId: "link-2",
      services: 3,
      devices: 5,
    });
  });

  it("counts a running set-up endpoint beneath a service that was never set up", () => {
    const running = endpoint("link-2", ConfigurableState.ConfigurableStateActive);

    expect(getSourcesState(groupsOf([...servedSources, linkService, running]), true)).toMatchObject(
      {
        variant: "success",
        label: "Active",
        services: 3,
        devices: 4,
      },
    );
  });

  it("points at the entity whose state names the tile", () => {
    const failing = service("relay.service", ConfigurableState.ConfigurableStateFailed);
    const conflicted = setUpCamera("cam-6", ConfigurableState.ConfigurableStateConflict);

    expect(getSourcesState(groupsOf([failing, ...mixedSources, conflicted]), true)).toMatchObject({
      label: "Conflict",
      entityId: "cam-6",
    });
  });

  describe("names the tile shown first when two raise it equally", () => {
    const lost = { link: create(LinkComponentSchema, { status: LinkStatus.LinkStatusLost }) };

    const missingCamera = cameraWithoutSetup(
      "yard-cam",
      DeviceState.DeviceStateFailed,
      "gone.service",
    );

    const failed = { variant: "alert", label: "Failed", entityId: missingCamera.id };

    it("a radar service before a camera whose service is missing, in the proto's order", () => {
      const weather = service("weather.service", ConfigurableState.ConfigurableStateActive);

      const wind = device("wx-wind", weather.id, {
        device: { parent: weather.id, class: "sensor", state: DeviceState.DeviceStateActive },
        classification: sensorClassification({ kind: { case: "radar", value: {} } }),
        ...lost,
      });

      expect(getSourcesState(groupsOf([weather, wind, missingCamera]), true)).toMatchObject({
        variant: "alert",
        label: "Lost",
        entityId: "wx-wind",
      });
    });

    it("a camera whose service is missing before an other service", () => {
      const relay = {
        ...service("relay.service", ConfigurableState.ConfigurableStateActive),
        ...lost,
      };

      expect(getSourcesState(groupsOf([relay, missingCamera]), true)).toMatchObject(failed);
    });

    it("a camera whose service is missing before a device without a service", () => {
      const mast = device("mast-1", "mast.service", {
        device: { parent: "mast.service", state: DeviceState.DeviceStateActive },
        ...lost,
      });

      expect(
        getSourcesState(groupsOf([...runningCameras, mast, missingCamera]), true),
      ).toMatchObject(failed);
    });
  });
});

describe("getSourceState", () => {
  it("rolls up only the services that offer cameras", () => {
    const failingTracker = service("tracker.service", ConfigurableState.ConfigurableStateFailed);
    const sources = mixedSources.map((e) => (e.id === tracker.id ? failingTracker : e));

    expect(getSourceState("electroOptical", groupsOf(sources), true)).toMatchObject({
      variant: "success",
      label: "Active",
      services: 2,
      devices: 3,
    });
  });

  it("names a failing camera beneath a service that declares no cameras", () => {
    const failed = webcam("webcam-2", DeviceState.DeviceStateFailed);

    expect(
      getSourceState("electroOptical", groupsOf([...mixedSources, failed]), true),
    ).toMatchObject({
      variant: "alert",
      label: "Failed",
      services: 2,
      devices: 4,
      entityId: "webcam-2",
    });
  });

  it("names a failing set-up camera beneath a camera service that was never set up, as Sources does", () => {
    const failing = setUpCamera("cam-9", ConfigurableState.ConfigurableStateFailed);

    const entities = groupsOf([
      service(WEBCAM_SERVICE_ID, ConfigurableState.ConfigurableStateActive),
      webcam("webcam-1"),
      cameraServiceNeverSetUp(),
      failing,
    ]);

    const named = { variant: "alert", label: "Failed", entityId: "cam-9" };

    expect(getSourceState("electroOptical", entities, true)).toEqual({
      ...named,
      services: 1,
      devices: 2,
    });
    expect(getSourcesState(entities, true)).toMatchObject(named);
  });

  it("names a failing set-up camera when no camera service is set up, as Sources does", () => {
    const entities = groupsOf([
      cameraServiceNeverSetUp(),
      setUpCamera("cam-9", ConfigurableState.ConfigurableStateFailed),
    ]);

    const named = { variant: "alert", label: "Failed", entityId: "cam-9" };

    expect(getSourceState("electroOptical", entities, true)).toMatchObject({
      ...named,
      services: 0,
      devices: 1,
    });
    expect(getSourcesState(entities, true)).toMatchObject(named);
  });

  it("counts a running set-up camera beneath a camera service that was never set up", () => {
    const entities = groupsOf([
      service(WEBCAM_SERVICE_ID, ConfigurableState.ConfigurableStateActive),
      webcam("webcam-1"),
      cameraServiceNeverSetUp(),
      setUpCamera("cam-9", ConfigurableState.ConfigurableStateActive),
      discoveredCamera("cam-3"),
    ]);

    expect(getSourceState("electroOptical", entities, true)).toMatchObject({
      variant: "success",
      label: "Active",
      services: 1,
      devices: 2,
    });
  });

  it("counts only sensors as devices, while any device beneath the service still raises it", () => {
    const sensors = service("sensor.service", ConfigurableState.ConfigurableStateActive);

    const receiver = device("sensor-1", sensors.id, {
      device: { parent: sensors.id, class: "sensor", state: DeviceState.DeviceStateActive },
      classification: sensorClassification({ kind: { case: "ew", value: {} } }),
      config: {},
      configurable: { state: ConfigurableState.ConfigurableStateActive },
    });

    const defaults = (state: ConfigurableState) =>
      device("sensor.service.defaults", sensors.id, {
        device: { parent: sensors.id, class: "defaults" },
        config: {},
        configurable: { state },
      });

    const calm = groupsOf([sensors, receiver, defaults(ConfigurableState.ConfigurableStateActive)]);

    const failing = groupsOf([
      sensors,
      receiver,
      defaults(ConfigurableState.ConfigurableStateFailed),
    ]);

    expect(getSourceState("ew", calm, true)).toMatchObject({ services: 1, devices: 1 });
    expect(getSourcesState(calm, true)).toMatchObject({ devices: 1 });
    expect(getSourceState("ew", failing, true)).toMatchObject({
      variant: "alert",
      entityId: "sensor.service.defaults",
      devices: 1,
    });
  });

  it("counts a service on each tile by the devices of that kind, and once overall", () => {
    const mast = service("mast.service", ConfigurableState.ConfigurableStateActive);
    const radar = sensorClassification({ kind: { case: "radar", value: {} } });
    const taxonomy = [...(cameraClassification()?.taxonomy ?? []), ...(radar?.taxonomy ?? [])];

    const groups = groupsOf([
      mast,
      device("mast-cam", mast.id, { classification: cameraClassification() }),
      device("mast-rx", mast.id, {
        classification: sensorClassification({ kind: { case: "ew", value: {} } }),
      }),
      device("mast-head", mast.id, { classification: { taxonomy } }),
    ]);

    expect(getSourceState("electroOptical", groups, true)).toMatchObject({
      services: 1,
      devices: 2,
    });
    expect(getSourceState("radar", groups, true)).toMatchObject({ services: 1, devices: 1 });
    expect(getSourceState("ew", groups, true)).toMatchObject({ services: 1, devices: 1 });
    expect(getSourcesState(groups, true)).toMatchObject({ services: 1, devices: 3 });
  });

  it("reads nothing when only a service without cameras is set up", () => {
    expect(
      getSourceState("electroOptical", groupsOf([tracker, cameraServiceNeverSetUp()]), true),
    ).toBeUndefined();
  });

  it("takes the look and word of the service tile that shows them", () => {
    const sources = [
      ...mixedSources,
      setUpCamera("cam-4", ConfigurableState.ConfigurableStateInactive),
    ];

    expect(
      stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [
        setUpCamera("cam-4", ConfigurableState.ConfigurableStateInactive),
      ]),
    ).toEqual({ variant: "success", label: "Active" });
    expect(getSourceState("electroOptical", groupsOf(sources), true)).toMatchObject({
      variant: "success",
      label: "Active",
    });
  });

  it("names a failing camera beneath a service that was never set up, beside a set-up one", () => {
    const failing = withError(
      setUpCamera("cam-9", ConfigurableState.ConfigurableStateFailed),
      "stream refused",
    );

    const entities = [
      service(WEBCAM_SERVICE_ID, ConfigurableState.ConfigurableStateActive),
      webcam("webcam-1"),
      cameraServiceNeverSetUp(),
      discoveredCamera("cam-3"),
      failing,
    ];

    const groups = groupsOf(entities);
    const withState = getSourceServices("electroOptical", groups).filter(inRollup);

    expect(withState.map(({ serviceId }) => serviceId)).toEqual([
      CAMERA_SERVICE_ID,
      WEBCAM_SERVICE_ID,
    ]);
    expect(stateOf(cameraServiceNeverSetUp(), entities)).toEqual({
      variant: "alert",
      label: "Failed",
      error: "stream refused",
    });
  });

  it("drops the running look while not connected and keeps the word", () => {
    expect(getSourceState("electroOptical", groupsOf(mixedSources), false)).toMatchObject({
      variant: "default",
      label: "Active",
    });
  });
});

describe("getWithoutServiceState", () => {
  it("names the most severe device whose service is not in the world", () => {
    const sources = [
      ...mixedSources,
      sensorWithoutService("sensor-2", DeviceState.DeviceStateFailed),
      sensorWithoutService("sensor-3", DeviceState.DeviceStateDegraded),
    ];

    expect(getWithoutServiceState(groupsOf(sources), true)).toEqual({
      variant: "alert",
      label: "Failed",
      entityId: "sensor-2",
      services: 0,
      devices: 3,
    });
  });

  it("leaves out pending devices that await setup and devices whose service exists", () => {
    const offered = device("sensor-4", "sensor.service", {
      device: { parent: "sensor.service", class: "sensor", state: DeviceState.DeviceStatePending },
      configurable: { state: ConfigurableState.ConfigurableStateFailed },
    });

    const failed = setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed);

    expect(
      getWithoutServiceState(groupsOf([...mixedSources, offered, failed]), true),
    ).toMatchObject({
      label: "Active",
      devices: 1,
    });
  });

  it("stays calm while its devices run, though each card reads running", () => {
    const sensor = sensorWithoutService("sensor-1", DeviceState.DeviceStateActive);

    expect(getWithoutServiceState(groupsOf(mixedSources), true)).toMatchObject({
      variant: "default",
      label: "Active",
    });
    expect(getOwnState(sensor, true)).toEqual({ variant: "success", label: "Active" });
  });

  it("reads nothing while every device has a service", () => {
    expect(getWithoutServiceState(groupsOf([tracker]), true)).toBeUndefined();
  });
});

describe("getOtherServicesState", () => {
  it("names a failing set-up service that offers no cameras or sensors, as Sources does", () => {
    const failing = service("tracker.service", ConfigurableState.ConfigurableStateFailed);
    const groups = groupsOf(mixedSources.map((e) => (e.id === tracker.id ? failing : e)));
    const named = { variant: "alert", label: "Failed" };

    expect(getOtherServicesState(groups, true)).toEqual({
      ...named,
      entityId: tracker.id,
      services: 1,
      devices: 0,
    });
    expect(getSourcesState(groups, true)).toMatchObject({ ...named, entityId: tracker.id });
    expect(getSourceState("electroOptical", groups, true)).toMatchObject({ variant: "success" });
  });

  it("lists a service without cameras or sensors that was never set up while a device beneath it fails", () => {
    const failing = endpoint("link-2", ConfigurableState.ConfigurableStateFailed);
    const groups = groupsOf([...mixedSources, linkService, failing]);

    expect(getOtherServices(groups).map(({ service }) => service.id)).toEqual([
      LINK_SERVICE_ID,
      tracker.id,
    ]);
    expect(getOtherServicesState(groups, true)).toMatchObject({
      variant: "alert",
      entityId: "link-2",
    });
  });

  it("leaves out a root with nothing to set up", () => {
    const node = create(EntitySchema, {
      id: "node.n1",
      device: { category: "Network", state: DeviceState.DeviceStateActive },
    });

    const groups = groupsOf([node, cameraServiceNeverSetUp()]);

    expect(getOtherServices(groups)).toEqual([]);
    expect(getSourcesState(groups, true)).toBeUndefined();
  });
});

describe("one rule for tiles, categories and the badge", () => {
  it("keeps a running service green while one of its cameras is switched off", () => {
    const entities = [
      ...runningCameras,
      setUpCamera("cam-4", ConfigurableState.ConfigurableStateInactive),
    ];

    const groups = groupsOf(entities);
    const running = { variant: "success", label: "Active" };

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), entities)).toEqual(
      running,
    );
    expect(getSourceState("electroOptical", groups, true)).toMatchObject(running);
    expect(getSourcesState(groups, true)).toMatchObject(running);
    expect(missionStateOf(entities)).toEqual(RUNNING);
  });

  it("names on Sources what the Cameras tile names when a camera service and another fail alike", () => {
    const relay = service("relay.service", ConfigurableState.ConfigurableStateFailed);
    const camera = setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed);
    const groups = groupsOf([relay, ...mixedSources, camera]);

    expect(getSourceState("electroOptical", groups, true)).toMatchObject({ entityId: "cam-2" });
    expect(getSourcesState(groups, true)).toMatchObject({ entityId: "cam-2" });
  });
});

const FINDER_ID = "onvif.service";

const finder: Service = {
  ...create(EntitySchema, { id: FINDER_ID, label: "ONVIF Discovery", config: {} }),
  device: create(DeviceComponentSchema, {
    category: "Network",
    state: DeviceState.DeviceStateActive,
  }),
};

describe("a device with nothing to set up", () => {
  it("stays calm and out of the count while it reports pending", () => {
    const find = cameraWithoutSetup(
      "onvif.device.cam-6",
      DeviceState.DeviceStatePending,
      FINDER_ID,
    );

    const entities = [...runningCameras, finder, find];
    const groups = groupsOf(entities);

    expect(getOwnState(find, true)).toEqual({ variant: "default", label: "Pending" });
    expect(getSourceServices("electroOptical", groups).map(({ serviceId }) => serviceId)).toEqual([
      CAMERA_SERVICE_ID,
      FINDER_ID,
    ]);
    expect(getServiceState(serviceOf(entities, FINDER_ID), true)).toEqual({
      variant: "success",
      label: "Active",
    });
    expect(getSourceState("electroOptical", groups, true)).toMatchObject({
      variant: "success",
      label: "Active",
      devices: 1,
    });
    expect(missionStateOf(entities)).toEqual(RUNNING);
  });

  it("names a find that reports a failure everywhere", () => {
    const find = cameraWithoutSetup("onvif.device.cam-6", DeviceState.DeviceStateFailed, FINDER_ID);
    const entities = [...runningCameras, finder, find];
    const failed = { variant: "alert", label: "Failed" };

    expect(getServiceState(serviceOf(entities, FINDER_ID), true)).toEqual(failed);
    expect(getSourceState("electroOptical", groupsOf(entities), true)).toMatchObject({
      ...failed,
      devices: 2,
    });
    expect(missionStateOf(entities)).toEqual({ severity: "alert", label: "Failed" });
  });

  it("counts a running webcam", () => {
    const entities = [
      ...runningCameras,
      service(WEBCAM_SERVICE_ID, ConfigurableState.ConfigurableStateActive),
      webcam("webcam-1"),
    ];

    expect(getSourceState("electroOptical", groupsOf(entities), true)).toMatchObject({
      variant: "success",
      devices: 2,
    });
    expect(missionStateOf(entities)).toEqual(RUNNING);
  });
});

function withLink<T extends Entity>(entity: T, status: LinkStatus): T {
  return { ...entity, link: create(LinkComponentSchema, { status }) };
}

describe("a raised link", () => {
  it("names a lost link over a running camera everywhere", () => {
    const camera = withLink(
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateActive),
      LinkStatus.LinkStatusLost,
    );

    const entities = [...runningCameras, camera];
    const lost = { variant: "alert", label: "Lost" };

    expect(getOwnState(camera, true)).toEqual(lost);
    expect(getServiceState(serviceOf(entities, CAMERA_SERVICE_ID), true)).toEqual(lost);
    expect(getSourcesState(groupsOf(entities), true)).toMatchObject(lost);
    expect(missionStateOf(entities)).toEqual({ severity: "alert", label: "Lost" });
  });

  it("counts a discovered unit that awaits setup once its link degrades", () => {
    const unit = discoveredCamera("cam-3");
    const degraded = withLink(unit, LinkStatus.LinkStatusDegraded);

    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [unit])).toEqual({
      variant: "success",
      label: "Active",
    });
    expect(stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [degraded])).toEqual({
      variant: "pending",
      label: "Degraded",
    });
    expect(getOwnState(degraded, true)).toEqual({ variant: "pending", label: "Degraded" });
  });

  it("keeps the own word when it is as severe as the link", () => {
    const camera = withLink(
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateFailed),
      LinkStatus.LinkStatusLost,
    );

    expect(getOwnState(camera, true)).toEqual({ variant: "alert", label: "Failed" });
  });

  it("keeps a worse own word over a degraded link", () => {
    const camera = withLink(
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateConflict),
      LinkStatus.LinkStatusDegraded,
    );

    expect(getOwnState(camera, true)).toEqual({ variant: "alert", label: "Conflict" });
  });

  it("names the service's own degraded link", () => {
    const root = withLink(
      cameraService(ConfigurableState.ConfigurableStateActive),
      LinkStatus.LinkStatusDegraded,
    );

    expect(stateOf(root)).toEqual({ variant: "pending", label: "Degraded" });
  });

  it("changes nothing while the link is connected", () => {
    const camera = withLink(
      setUpCamera("cam-2", ConfigurableState.ConfigurableStateActive),
      LinkStatus.LinkStatusConnected,
    );

    const unit = withLink(discoveredCamera("cam-3"), LinkStatus.LinkStatusConnected);

    expect(getOwnState(camera, true)).toEqual({ variant: "success", label: "Active" });
    expect(
      stateOf(cameraService(ConfigurableState.ConfigurableStateActive), [camera, unit]),
    ).toEqual({
      variant: "success",
      label: "Active",
    });
  });
});

describe("error of an entity", () => {
  it("carries a set-up camera's device error when its configurable has none", () => {
    const camera = setUpCamera("cam-2", ConfigurableState.ConfigurableStateActive);
    const withDeviceError = { ...camera, device: { ...camera.device!, error: "lens fogged" } };

    expect(getOwnState(withDeviceError, true)).toEqual({
      variant: "success",
      label: "Active",
      error: "lens fogged",
    });
  });

  it("carries a failing service's device error when its configurable has none", () => {
    const root = cameraService(ConfigurableState.ConfigurableStateFailed);
    const failing = { ...root, device: { ...root.device, error: "disk full" } };

    expect(stateOf(failing)).toEqual({ variant: "alert", label: "Failed", error: "disk full" });
  });

  it("prefers the configurable error over the device error before setup", () => {
    const camera = discoveredCamera("cam-3", CAMERA_SERVICE_ID, DeviceState.DeviceStateFailed);

    const failing = {
      ...camera,
      device: { ...camera.device!, error: "probe timed out" },
      configurable: create(ConfigurableComponentSchema, { error: "auth rejected" }),
    };

    expect(getOwnState(failing, true).error).toBe("auth rejected");
  });
});

function localNow() {
  return new Date(2026, 9, 17, 21, 7, 12).getTime();
}

function polled(state: ConfigurableState, scheduledAt?: Date): Entity {
  return create(EntitySchema, {
    id: "netscan.service",
    device: {},
    configurable: { state, scheduledAt: scheduledAt && timestampFromDate(scheduledAt) },
    config: {},
  });
}

function shownLabels(entity: Entity) {
  const groups = groupsOf([entity]);

  return [
    getServiceState(serviceOf([entity], entity.id), true),
    getOtherServicesState(groups, true),
    getSourcesState(groups, true),
  ].map((state) => getStateLabel(state, localNow()));
}

describe("the time a scheduled service starts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names a time later today in local time", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");

    const entity = polled(
      ConfigurableState.ConfigurableStateScheduled,
      new Date(2026, 9, 17, 23, 30, 45),
    );

    expect(shownLabels(entity)).toEqual(Array(3).fill("Scheduled · 23:30:45"));
  });

  it("names the local date of a time after midnight, even within a day", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");

    const entity = polled(
      ConfigurableState.ConfigurableStateScheduled,
      new Date(2026, 9, 18, 8, 5, 9),
    );

    expect(shownLabels(entity)).toEqual(Array(3).fill("Scheduled · 18 Oct 08:05:09"));
  });

  it("drops a time that has passed", () => {
    const entity = polled(
      ConfigurableState.ConfigurableStateScheduled,
      new Date(2026, 9, 17, 21, 6, 50),
    );

    expect(shownLabels(entity)).toEqual(Array(3).fill("Scheduled"));
  });

  it("reads Scheduled alone without a time", () => {
    const entity = polled(ConfigurableState.ConfigurableStateScheduled);

    expect(shownLabels(entity)).toEqual(Array(3).fill("Scheduled"));
  });

  it("shows no time beside a state other than Scheduled", () => {
    const entity = polled(ConfigurableState.ConfigurableStateActive, new Date(2026, 9, 17, 23, 30));

    expect(shownLabels(entity)).toEqual(Array(3).fill("Active"));
  });
});

describe("the node", () => {
  const NODE_ID = "node.7c2e";

  type NodeInit = {
    state?: DeviceState;
    error?: string;
    config: boolean;
    configurable?: ConfigurableState;
  };

  function node({
    state = DeviceState.DeviceStateActive,
    error,
    config,
    configurable,
  }: NodeInit): Entity {
    return create(EntitySchema, {
      id: NODE_ID,
      label: "Relay host",
      device: { category: "Network", state, error, node: { hostname: "relay-host" } },
      configurable: configurable === undefined ? undefined : { state: configurable },
      config: config ? {} : undefined,
    });
  }

  const FAILED = { state: DeviceState.DeviceStateFailed, error: "disk full" };

  const radar = device("radar-1", NODE_ID, {
    classification: sensorClassification({ kind: { case: "radar", value: {} } }),
  });

  const otherServiceIds = (entities: Entity[]) =>
    getOtherServices(groupDevices(entityMap(entities))).map(({ serviceId }) => serviceId);

  it.each([false, true])("raises the badge when it fails, with a config: %s", (config) => {
    const groups = groupDevices(entityMap([node({ ...FAILED, config }), device("usb-1", NODE_ID)]));

    expect(getMissionState(groups, true)).toEqual({ severity: "alert", label: "Failed" });
  });

  it.each([
    ["Inactive", ConfigurableState.ConfigurableStateInactive],
    ["Starting", ConfigurableState.ConfigurableStateStarting],
  ])("names its failed device over a configurable that reads %s", (_name, configurable) => {
    const groups = groupDevices(entityMap([node({ ...FAILED, config: true, configurable })]));

    expect(getMissionState(groups, true)).toEqual({ severity: "alert", label: "Failed" });
  });

  it.each([false, true])(
    "raises the badge when its configurable fails, with a config: %s",
    (config) => {
      const failing = node({ config, configurable: ConfigurableState.ConfigurableStateFailed });

      expect(getMissionState(groupDevices(entityMap([failing])), true)).toEqual({
        severity: "alert",
        label: "Failed",
      });
    },
  );

  it.each([false, true])("names its own failure on its group, with a config: %s", (config) => {
    const failing = node({ ...FAILED, config });
    const entities = entityMap([failing, device("usb-1", NODE_ID)]);

    expect(getSourceRowState(failing, groupDevices(entities), entities, true)).toMatchObject({
      variant: "alert",
      label: "Failed",
    });
  });

  it.each([false, true])(
    "lists a failed node with nothing under it, with a config: %s",
    (config) => {
      expect(otherServiceIds([node({ ...FAILED, config })])).toEqual([NODE_ID]);
    },
  );

  it.each([false, true])(
    "leaves out a healthy node with nothing under it, with a config: %s",
    (config) => {
      expect(otherServiceIds([node({ config })])).toEqual([]);
    },
  );

  it.each([false, true])(
    "lists a healthy node that has devices under it, with a config: %s",
    (config) => {
      expect(otherServiceIds([node({ config }), device("usb-1", NODE_ID)])).toEqual([NODE_ID]);
    },
  );

  it.each([false, true])("never counts as a service, with a config: %s", (config) => {
    const groups = groupDevices(entityMap([node({ config }), radar]));

    expect(getSourceState("radar", groups, true)).toMatchObject({ services: 0, devices: 1 });
  });
});
