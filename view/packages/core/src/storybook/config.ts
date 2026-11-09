import type { JsonObject } from "@bufbuild/protobuf";
import { clone } from "@bufbuild/protobuf";
import type { ConfigurableState, Entity } from "@projectqai/proto/world";
import { EntitySchema } from "@projectqai/proto/world";

export const WAITING = "Waiting for the device to apply your settings";

const STREAM_FIELDS = {
  resolution: "Resolution",
  codec: "Codec",
  fps: "FPS",
  compression: "Compression",
  bitrate: "Bitrate (kbps)",
  keyframe_interval: "Keyframe Interval",
  bitrate_mode: "Bitrate Mode",
  h264_profile: "H.264 Profile",
  stream_name: "Stream name",
  rotation: "Rotation",
  overlay_text: "Overlay text",
};

export function streamSchema(group?: { key: string; title: string }): JsonObject {
  return {
    type: "object",
    ...(group && { "ui:groups": [group] }),
    properties: Object.fromEntries(
      Object.entries(STREAM_FIELDS).map(([key, title]) => [
        key,
        { type: "string", title, ...(group && { "ui:group": group.key }) },
      ]),
    ),
  };
}

export function answeredWith(
  entity: Entity,
  state: ConfigurableState,
  error: string | undefined,
  appliedVersion: bigint,
): Entity {
  const answer = clone(EntitySchema, entity);

  if (!answer.configurable) throw new Error(`${entity.id} has no configurable to answer with`);

  answer.configurable.state = state;
  answer.configurable.error = error;
  answer.configurable.appliedVersion = appliedVersion;

  return answer;
}

export function withSchema(entity: Entity, schema: JsonObject): Entity {
  const settable = clone(EntitySchema, entity);

  if (!settable.configurable) throw new Error(`${entity.id} has no configurable to give a schema`);

  settable.configurable.schema = schema;

  return settable;
}
