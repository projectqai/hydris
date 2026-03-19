import { create, EntitySchema, EntityFilterSchema, ListEntitiesRequestSchema, EntityChange, attach, push } from "@projectqai/proto/device";
import { CameraComponentSchema, MediaStreamProtocol, AdministrativeComponentSchema } from "@projectqai/proto/world";

const BASE_URL = "https://hexdb.io";
let seenCount = 0n, enrichedCount = 0n, latencyMs = 0;

await attach({
	id: "hexdb.service",
	label: "HexDB",
	controller: "hexdb",
	device: { category: "Feeds" },
	icon: "camera",
	schema: {
		administrative: {
			type: "boolean",
			title: "Enrich Administrative Data",
			description: "Also look up registration, owner, and type from the aircraft API",
			default: false,
		},
	} as const,
	config: { administrative: false },

	run: async (client, config, signal) => {
		console.log(`started administrative=${config.administrative}`);

		const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
			filter: create(EntityFilterSchema, {
				component: [27],
				not: create(EntityFilterSchema, { component: [15] }),
			}),
			behaviour: { maxRateHz: 3 },
		}), { signal });

		for await (const event of stream) {
			if (!event.entity || event.t !== EntityChange.EntityChangeUpdated) continue;
			const ent = event.entity;
			if (!ent.transponder?.adsb?.icaoAddress) continue;

			seenCount++;
			const icaoHex = ent.transponder.adsb.icaoAddress.toString(16).padStart(6, "0");
			const enriched = create(EntitySchema, { id: ent.id });
			let changed = false;
			const t0 = performance.now();

			try {
				const resp = await fetch(`${BASE_URL}/hex-image?hex=${icaoHex}`, { signal: AbortSignal.timeout(10_000) });
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				const imageURL = (await resp.text()).trim();
				if (!imageURL || !imageURL.startsWith("http")) throw new Error("no image");
				enriched.camera = create(CameraComponentSchema, {
					streams: [{ label: icaoHex, url: imageURL, protocol: MediaStreamProtocol.MediaStreamProtocolImage }],
				});
				changed = true;
			} catch (err) { console.debug(`enrich image failed for ${icaoHex}: ${err}`); }

			if (config.administrative) {
				try {
					const resp = await fetch(`${BASE_URL}/api/v1/aircraft/${icaoHex}`, { signal: AbortSignal.timeout(10_000) });
					if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
					const ac = await resp.json() as Record<string, string>;
					enriched.administrative = create(AdministrativeComponentSchema, {
						...(ac.Registration && { id: ac.Registration }),
						...(ac.RegisteredOwners && { owner: ac.RegisteredOwners }),
						...(ac.Manufacturer && { manufacturer: ac.Manufacturer }),
						...(ac.Type && { model: ac.Type }),
						});
					changed = true;
				} catch (err) { console.debug(`enrich administrative failed for ${icaoHex}: ${err}`); }
			}

			latencyMs = performance.now() - t0;

			if (changed) { await push(client, enriched); enrichedCount++; }
		}
	},

	health: () => ({
		1: { label: "entities enriched", value: enrichedCount },
		2: { label: "entities seen", value: seenCount },
		3: { label: "lookup latency ms", value: latencyMs },
	}),
});
