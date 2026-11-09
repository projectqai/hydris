// This plugin accepts unauthenticated LoRa frames. Enabling it is the opt-in;
// README.md says what a sender on the air can and cannot do.

import { create } from "@bufbuild/protobuf";
import { attach, connect, push, sleep } from "@projectqai/proto/device";
import {
	CaptureFilterSchema,
	ControllerFilterSchema,
	EntityChange,
	EntityFilterSchema,
	ListEntitiesRequestSchema,
} from "@projectqai/proto/world";
import { ACTOR, CONTROLLER, PORT_RAW, decodeFrame, frameToEntities } from "./raw";

const SERVICE_ID = "unsafelora.service";
const CAPTURE_CONTROLLER = "lora";

const stats = { seen: 0n, decoded: 0n, rejected: 0n };

await attach({
	id: SERVICE_ID,
	label: "Unsafe LoRa (unauthenticated frames)",
	controller: CONTROLLER,
	device: { category: "Network" },
	icon: "unlock",
	// attach() only runs a plugin once its entity carries a config, so ship an
	// empty one. There is nothing to configure: enabling the plugin is the opt-in.
	config: {},
	interval: 2000,

	run: async (client, _config, signal) => {
		console.warn("decoding UNAUTHENTICATED LoRa frames; anyone with a radio in range can push sensor reports");
		// Frames go out as the air identity, whose policy in defaults.yaml is
		// tighter than what this code itself may do.
		const air = connect(undefined, { actor: ACTOR });
		while (!signal.aborted) {
			const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
				filter: create(EntityFilterSchema, {
					controller: create(ControllerFilterSchema, { id: CAPTURE_CONTROLLER }),
					capture: create(CaptureFilterSchema, { port: PORT_RAW }),
				}),
			}), { signal });
			try {
				for await (const ev of stream) {
					if (ev.t !== EntityChange.EntityChangeUpdated) continue;
					const e = ev.entity;
					if (!e?.capture) continue;
					stats.seen++;
					const wire = decodeFrame(e.capture.payload ?? new Uint8Array(0));
					const entities = wire ? frameToEntities(wire, e.capture.capturedBy ?? "", e.link, new Date()) : [];
					if (entities.length === 0) { stats.rejected++; continue; }
					try {
						await push(air, ...entities);
					} catch (err) {
						console.warn("frame rejected:", err);
						stats.rejected++;
						continue;
					}
					stats.decoded++;
				}
				return;
			} catch (err) {
				if (signal.aborted) return;
				console.error("frame watch:", err);
				await sleep(2000, signal);
			}
		}
	},

	health: () => ({
		1: { label: "frames seen", value: stats.seen },
		2: { label: "frames decoded", value: stats.decoded },
		3: { label: "frames rejected", value: stats.rejected },
	}),
});
