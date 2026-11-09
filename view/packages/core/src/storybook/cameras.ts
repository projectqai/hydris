import type { JsonObject } from "@bufbuild/protobuf";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState } from "@projectqai/proto/world";

import type { EntityInit } from "./entities";
import {
  CAMERA_CLASSES,
  cameraClassification,
  cameraService,
  configDevice,
  entity,
  notSetUpCameraService,
  setUpCamera,
} from "./entities";

export const DOCK_ERROR = "rtsp handshake refused by 10.0.4.18 after 3 attempts";

export const SERVICE_SCHEMA: JsonObject = {
  type: "object",
  properties: { username: { type: "string", title: "Username" } },
};

export const simcamService = cameraService("simcam.service", "Camera Debugger");

export const gateCamera = setUpCamera(
  "simcam-1",
  "Gate camera",
  "simcam.service",
  ConfigurableState.ConfigurableStateActive,
);

export function dockCamera(state: ConfigurableState, error?: string): Entity {
  return setUpCamera("simcam-2", "Dock camera", "simcam.service", state, error);
}

export function axisService(init?: EntityInit): Entity {
  return cameraService("axis.service", "AXIS Cameras", init);
}

export function cameraAwaitingSetup(schema?: JsonObject, ip = "10.0.4.17"): Entity {
  const label = `AXIS Camera ${ip}`;

  return entity(`axis.device.${ip.replaceAll(".", "_")}`, {
    label,
    configurable: { label, schema },
    device: { parent: "axis.service", class: "camera", state: DeviceState.DeviceStatePending },
    classification: cameraClassification(),
  });
}

export const wildlifeService = notSetUpCameraService("wildlife.service", "Wildlife cameras", {
  configurable: { supportedDeviceClasses: CAMERA_CLASSES, schema: SERVICE_SCHEMA },
});

export const nvrService = entity("nvr.service", {
  label: "nvr",
  device: { category: "Cameras", state: DeviceState.DeviceStateActive },
  configurable: { label: "Bay recorders", state: ConfigurableState.ConfigurableStateActive },
  config: {},
});

export const runningVideoService = [
  cameraService("video.service", "Video service"),
  setUpCamera(
    "gate-camera",
    "Gate camera",
    "video.service",
    ConfigurableState.ConfigurableStateActive,
  ),
];

export const startingFeed = configDevice(
  "uplink-feed",
  ConfigurableState.ConfigurableStateStarting,
);
