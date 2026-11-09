// Port 0x4E carries unauthenticated hydrispayload frames.

import { clone, create, fromBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
	ChannelSchema,
	ControllerSchema,
	EntitySchema,
	LifetimeSchema,
	LinkComponentSchema,
	PoseComponentSchema,
	RoutingSchema,
	TrackComponentSchema,
	type Entity,
	type LinkComponent,
} from "@projectqai/proto/world";

export const PORT_RAW = 0x4e;
export const CONTROLLER = "unsafelora";
// Frame-derived entities are pushed as this identity and carry it as their
// controller, so its policy can tell them from everything else in the world.
export const ACTOR = "unsafelora.actor";
export const DETECTION_TTL_S = 120;

const ts = (d: Date) => create(TimestampSchema, { seconds: BigInt(Math.floor(d.getTime() / 1000)) });

// Compressed hydrispayload frames are unsupported here.
export function decodeFrame(payload: Uint8Array): Entity | null {
	if (payload.length < 1 || payload[0] !== 0) return null;
	try {
		return fromBinary(EntitySchema, payload.subarray(1));
	} catch {
		return null;
	}
}

export function frameToEntities(wire: Entity, gateway: string, link: LinkComponent | undefined, now: Date): Entity[] {
	if (!wire.id) return [];
	const out = clone(EntitySchema, wire);
	out.controller = create(ControllerSchema, { id: ACTOR, origin: gateway });
	out.routing = create(RoutingSchema, { channels: [create(ChannelSchema, {})] });
	out.link = link ? clone(LinkComponentSchema, link) : undefined;
	return [out];
}
