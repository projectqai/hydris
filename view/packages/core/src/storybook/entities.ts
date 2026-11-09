import type { MessageInitShape } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { Metric } from "@projectqai/proto/metrics";
import { MetricKind, MetricSchema, MetricUnit } from "@projectqai/proto/metrics";
import type { EquipmentTaxonomySensorSchema } from "@projectqai/proto/taxonomy";
import type { Entity, MissionPack } from "@projectqai/proto/world";
import {
  ClassificationIdentity,
  ConfigurableState,
  DeviceState,
  EntitySchema,
  LinkStatus,
  MediaStreamProtocol,
  MissionPackSchema,
} from "@projectqai/proto/world";

import type { LevelValue } from "../features/sensors/types";
import { ago } from "./clock";

export type EntityInit = Exclude<MessageInitShape<typeof EntitySchema>, Entity>;

type MetricInit = Exclude<MessageInitShape<typeof MetricSchema>, Metric>;

type MissionPackInit = Exclude<MessageInitShape<typeof MissionPackSchema>, MissionPack>;

const SYMBOL = { milStd2525C: "SFGPUCR---*****" };

const AFFILIATION: Record<ClassificationIdentity, string> = {
  [ClassificationIdentity.ClassificationIdentityInvalid]: "U",
  [ClassificationIdentity.ClassificationIdentityPending]: "P",
  [ClassificationIdentity.ClassificationIdentityUnknown]: "U",
  [ClassificationIdentity.ClassificationIdentityFriend]: "F",
  [ClassificationIdentity.ClassificationIdentityNeutral]: "N",
  [ClassificationIdentity.ClassificationIdentityHostile]: "H",
  [ClassificationIdentity.ClassificationIdentitySuspect]: "S",
};

export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    host: { type: "string", title: "Host" },
    port: { type: "integer", title: "Port" },
  },
};

export const CONFIG_VALUE = { host: "10.0.0.12", port: 8554 };

const HEADING_110 = { w: 0.573576, x: 0, y: 0, z: 0.819152 };

export function entity(id: string, init: EntityInit = {}): Entity {
  return create(EntitySchema, { ...init, id });
}

export function entityMap(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

export function asset(
  id: string,
  device: DeviceState,
  link?: LinkStatus,
  init?: EntityInit,
): Entity {
  return entity(id, {
    symbol: SYMBOL,
    geo: { latitude: 52.52, longitude: 13.4 },
    device: { state: device },
    link: link === undefined ? undefined : { status: link },
    ...init,
  });
}

export function readyAsset(id: string): Entity {
  return asset(id, DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected);
}

type SensorInit = MessageInitShape<typeof EquipmentTaxonomySensorSchema>;

export function sensorClassification(sensor: SensorInit = {}): EntityInit["classification"] {
  return { taxonomy: [{ kind: { case: "equipment", value: { sensor } } }] };
}

export function cameraClassification(): EntityInit["classification"] {
  return sensorClassification({ kind: { case: "electroOptical", value: {} } });
}

export function equipmentAsset(id: string, label: string, init?: EntityInit): Entity {
  return asset(id, DeviceState.DeviceStateActive, undefined, {
    label,
    classification: { taxonomy: [{ kind: { case: "equipment", value: {} } }] },
    ...init,
  });
}

export function track(id: string, identity: ClassificationIdentity, init?: EntityInit): Entity {
  return entity(id, {
    symbol: { milStd2525C: `S${AFFILIATION[identity]}GPUCR---*****` },
    geo: { latitude: 52.5309, longitude: 13.3847, altitude: 34 },
    classification: { identity },
    track: { tracker: "radar-1" },
    lifetime: { from: ago(600), fresh: ago(60) },
    ...init,
  });
}

export function hostileTrack(init?: EntityInit): Entity {
  return track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, {
    label: "TANGO 21",
    controller: { id: "hub-north" },
    orientation: { orientation: HEADING_110 },
    kinematics: { velocityEnu: { east: 3, north: 4 } },
    ...init,
  });
}

export function detection(id: string, detectorEntityId: string, init?: EntityInit): Entity {
  return entity(id, {
    detection: { detectorEntityId, confidence: 0.82 },
    bearing: { azimuth: 37 },
    lifetime: { from: ago(180) },
    ...init,
  });
}

type StreamInit = NonNullable<NonNullable<EntityInit["camera"]>["streams"]>[number];

export function webrtc(label: string, url: string): StreamInit {
  return { label, url, protocol: MediaStreamProtocol.MediaStreamProtocolWebrtc };
}

export function camera(id: string, streams: StreamInit[], init?: EntityInit): Entity {
  return entity(id, {
    symbol: SYMBOL,
    geo: { latitude: 52.5163, longitude: 13.3777 },
    camera: { streams },
    ...init,
  });
}

export const CAMERA_CLASSES = [{ class: "camera", label: "Camera" }];

export function cameraService(id: string, label: string, init?: EntityInit): Entity {
  return entity(id, {
    label,
    device: { category: "Cameras", state: DeviceState.DeviceStateActive },
    configurable: {
      supportedDeviceClasses: CAMERA_CLASSES,
      state: ConfigurableState.ConfigurableStateActive,
    },
    config: {},
    ...init,
  });
}

export function notSetUpCameraService(id: string, label: string, init?: EntityInit): Entity {
  return entity(id, {
    label,
    device: { category: "Cameras" },
    configurable: { supportedDeviceClasses: CAMERA_CLASSES },
    ...init,
  });
}

export function setUpCamera(
  id: string,
  label: string,
  parent: string,
  state: ConfigurableState,
  error?: string,
): Entity {
  return camera(id, [], {
    label,
    device: { parent, class: "camera", state: DeviceState.DeviceStateActive },
    classification: cameraClassification(),
    configurable: { state, error },
    config: { value: {}, version: 1n },
  });
}

export function webcams(): Entity[] {
  return [
    entity("webcam.service", {
      label: "Webcams",
      device: { category: "Cameras" },
      configurable: { label: "Webcams", state: ConfigurableState.ConfigurableStateActive },
      config: {},
    }),
    camera("webcam-1", [], {
      label: "Desk webcam",
      device: { parent: "webcam.service", class: "camera", state: DeviceState.DeviceStateActive },
      classification: cameraClassification(),
    }),
  ];
}

export function dockWebcam(state: ConfigurableState, error?: string): Entity {
  return setUpCamera("webcam-2", "Dock webcam", "webcam.service", state, error);
}

export function metric(
  kind: MetricKind,
  unit: MetricUnit,
  value: number,
  init?: MetricInit,
): Metric {
  return create(MetricSchema, {
    kind,
    unit,
    val: { case: "double", value },
    measuredAt: ago(120),
    ...init,
  });
}

export function radiationSensor(id: string, doseRate: number, init?: EntityInit): Entity {
  const kind = MetricKind.MetricKindRadiationHazard;

  return entity(id, {
    label: id,
    device: { state: DeviceState.DeviceStateActive },
    link: { status: LinkStatus.LinkStatusConnected, rssiDbm: -61 },
    metric: {
      metrics: [
        metric(kind, MetricUnit.MetricUnitMicrosievertPerHour, doseRate, { id: 1 }),
        metric(kind, MetricUnit.MetricUnitMicrosievert, 12.4, { id: 2 }),
      ],
    },
    ...init,
  });
}

export function chemicalSensor(id: string, levels: LevelValue[], init?: EntityInit): Entity {
  return entity(id, {
    label: id,
    device: { state: DeviceState.DeviceStateActive },
    link: { status: LinkStatus.LinkStatusConnected, rssiDbm: -61 },
    metric: {
      metrics: levels.map((level, index) =>
        metric(MetricKind.MetricKindChemicalHazard, MetricUnit.MetricUnitUnspecified, level.value, {
          id: index + 1,
          label: level.code,
          range:
            level.max === undefined ? undefined : { max: { case: "maxDouble", value: level.max } },
        }),
      ),
    },
    ...init,
  });
}

export function configDevice(id: string, state: ConfigurableState, init?: EntityInit): Entity {
  return entity(id, {
    label: id,
    device: { state: DeviceState.DeviceStateActive, category: "Sensors" },
    configurable: {
      label: id,
      state,
      schema: CONFIG_SCHEMA,
      value: CONFIG_VALUE,
      appliedVersion: 3n,
    },
    config: { value: CONFIG_VALUE, version: 3n },
    ...init,
  });
}

export function taskable(
  id: string,
  label: string,
  contextEntityIds: string[],
  init?: EntityInit,
): Entity {
  return entity(id, {
    taskable: {
      label,
      priority: 1,
      context: contextEntityIds.map((entityId) => ({ entityId })),
    },
    ...init,
  });
}

export function artifact(
  id: string,
  contentType: string,
  sizeBytes: bigint,
  init?: EntityInit,
): Entity {
  return entity(id, { label: id, artifact: { contentType, sizeBytes }, ...init });
}

export function missionPack(init?: MissionPackInit): MissionPack {
  return create(MissionPackSchema, {
    entityCount: 214,
    packVersion: "1.8.2",
    importedAt: ago(3600),
    artifactCount: 7,
    artifactTotalSize: 48_234_112n,
    ...init,
  });
}
