// Thin re-export + builder layer over the generated @projectqai/proto code, so
// suites don't each have to know the connect-es v2 / bufbuild create() idioms.
import { create } from "@bufbuild/protobuf";

import {
  WorldService,
  EntitySchema,
  EntityChangeRequestSchema,
  LifetimeSchema,
  type Entity,
} from "@projectqai/proto/world";

import {
  ArtifactService,
  UploadArtifactRequestSchema,
  DownloadArtifactRequestSchema,
} from "@projectqai/proto/artifacts";

import { TimestampSchema } from "@bufbuild/protobuf/wkt";

export {
  WorldService,
  ArtifactService,
  UploadArtifactRequestSchema,
  DownloadArtifactRequestSchema,
  EntityChangeRequestSchema,
  type Entity,
};

// ---- entity / message builders --------------------------------------------

export function plainEntity(id: string, extra: Record<string, unknown> = {}) {
  return create(EntitySchema, { id, ...extra });
}

export function changeRequest(...changes: Entity[]) {
  return create(EntityChangeRequestSchema, { changes });
}

/** A whole-entity replacement request (components omitted from the entity are removed). */
export function replaceRequest(...replacements: Entity[]) {
  return create(EntityChangeRequestSchema, { replacements });
}

/** A lifetime-only entity update (component-merge Push); leaves other components intact. */
export function lifetimeUpdate(id: string, opts: { until?: Date; fresh?: Date }) {
  return create(EntitySchema, {
    id,
    lifetime: create(LifetimeSchema, {
      until: opts.until ? tsFrom(opts.until) : undefined,
      fresh: opts.fresh ? tsFrom(opts.fresh) : undefined,
    }),
  });
}

/** Milliseconds since epoch from a proto Timestamp, or null. */
export function tsToMillis(t?: { seconds?: bigint; nanos?: number }): number | null {
  if (!t || t.seconds === undefined) return null;
  return Number(t.seconds) * 1000 + Math.floor((t.nanos ?? 0) / 1_000_000);
}

export function uploadMsg(idWithKey: string, chunk: Uint8Array, contentType = "") {
  return create(UploadArtifactRequestSchema, { id: idWithKey, chunk, contentType });
}

export function downloadById(idWithKey: string) {
  return create(DownloadArtifactRequestSchema, { ref: { case: "id", value: idWithKey } });
}

function tsFrom(d: Date) {
  const ms = d.getTime();
  return create(TimestampSchema, {
    seconds: BigInt(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  });
}
