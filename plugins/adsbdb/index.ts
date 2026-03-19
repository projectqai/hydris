import { create, EntitySchema, EntityFilterSchema, ListEntitiesRequestSchema, EntityChange, attach, push } from "@projectqai/proto/device";
import { AdministrativeComponentSchema } from "@projectqai/proto/world";
import { lookupCountry } from "./icao-country";

interface AircraftRecord {
	icao: string;
	reg: string;
	icaotype?: string;
	year?: string;
	manufacturer?: string;
	model?: string;
	ownop?: string;
	mil?: boolean;
}

let enrichedCount = 0n, seenCount = 0n, dbRecords = 0n;
let db = new Map<string, AircraftRecord>();

declare const Bun: { file(path: string): { stream(): { getReader(): any; pipeThrough(t: any): any } } };

async function loadDB(): Promise<Map<string, AircraftRecord>> {
	console.log("loading ADS-B Exchange aircraft database");
	const gz = new DecompressionStream("gzip");
	const decompressed = Bun.file("basic-ac-db.json.gz").stream().pipeThrough(gz);
	const reader = decompressed.getReader();
	const decoder = new TextDecoder();

	const db = new Map<string, AircraftRecord>();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split("\n");
		buffer = lines.pop()!;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const rec = JSON.parse(line) as AircraftRecord;
				if (rec.icao) db.set(rec.icao.toLowerCase(), rec);
			} catch { /* skip malformed lines */ }
		}
	}

	if (buffer.trim()) {
		try {
			const rec = JSON.parse(buffer) as AircraftRecord;
			if (rec.icao) db.set(rec.icao.toLowerCase(), rec);
		} catch { /* skip */ }
	}

	console.log(`loaded ADS-B Exchange database: ${db.size} records`);
	return db;
}

await attach({
	id: "adsbdb.service",
	label: "ADS-B Database",
	controller: "adsbdb",
	device: { category: "Feeds" },
	icon: "database",
	schema: {} as const,
	config: {},

	init: async () => {
		db = await loadDB();
		dbRecords = BigInt(db.size);
	},

	run: async (client, _config, signal) => {
		const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
			filter: create(EntityFilterSchema, {
				component: [27], // TransponderComponent
				not: create(EntityFilterSchema, { component: [28] }), // exclude AdministrativeComponent
			}),
		}), { signal });

		console.log("watching for transponder entities");

		for await (const event of stream) {
			if (!event.entity || event.t !== EntityChange.EntityChangeUpdated) continue;
			const ent = event.entity;
			if (!ent.transponder?.adsb?.icaoAddress) continue;

			seenCount++;
			const icaoHex = ent.transponder.adsb.icaoAddress.toString(16).padStart(6, "0");
			const rec = db.get(icaoHex);
			if (!rec) continue;

			const country = lookupCountry(ent.transponder.adsb.icaoAddress);
			const admin = create(AdministrativeComponentSchema, {
				...(rec.reg && { id: rec.reg }),
				...(rec.ownop && { owner: rec.ownop }),
				...(rec.manufacturer && { manufacturer: rec.manufacturer }),
				...(rec.model && { model: rec.model }),
				...(country && { flag: country }),
				});

			const hasData = rec.reg || rec.ownop || rec.manufacturer || rec.model || country;
			if (!hasData) continue;

			await push(client, create(EntitySchema, {
				id: ent.id,
				administrative: admin,
			}));

			enrichedCount++;
		}
	},

	health: () => ({
		1: { label: "database records", value: dbRecords },
		2: { label: "entities enriched", value: enrichedCount },
	}),
});
