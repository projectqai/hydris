import { create, EntitySchema, attach, push, type Entity } from "@projectqai/proto/device";
import {
	GeoSpatialComponentSchema,
	CovarianceMatrixSchema,
	ControllerSchema,
	LifetimeSchema,
	RoutingSchema,
	ChannelSchema,
	ClassificationComponentSchema,
	ClassificationIdentity,
	DetectionComponentSchema,
	InteractivityComponentSchema,
	SymbolComponentSchema,
	Priority,
} from "@projectqai/proto/world";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";

const ENTITY_ID = "blitzortung.service";

// Blitzortung distributes the live feed over a handful of identical WebSocket
// servers; pick one per connection and fail over on disconnect.
const SERVERS = [
	"wss://ws1.blitzortung.org/",
	"wss://ws7.blitzortung.org/",
	"wss://ws8.blitzortung.org/",
];

// Frames are compressed with the LZW variant used by lightningmaps.org.
// JSON.parse on the raw frame throws — decode first.
function lzwDecode(data: string): string {
	const dict: Record<number, string> = {};
	const chars = data.split("");
	let prev = chars[0];
	let result = prev;
	let first = prev;
	let code = 256;
	for (let i = 1; i < chars.length; i++) {
		const cc = chars[i].charCodeAt(0);
		const entry = cc < 256 ? chars[i] : (dict[cc] || prev + first);
		result += entry;
		first = entry.charAt(0);
		dict[code++] = prev + first;
		prev = entry;
	}
	return result;
}

interface Strike {
	time: number; // nanoseconds since epoch
	lat: number;
	lon: number;
	pol?: number; // polarity
	mds?: number;
	mcg?: number;
	sig?: unknown[]; // detecting stations
}

const schema = {
	ttl: {
		type: "integer",
		title: "Strike Lifetime",
		description: "Seconds a strike stays on the map before fading",
		default: 30,
		"ui:widget": "stepper",
		"ui:order": 0,
	},
} as const;

let receivedCount = 0n;
let publishedCount = 0n;
let errorCount = 0n;
let reconnects = 0n;
let connected = 0;

await attach({
	id: ENTITY_ID,
	label: "Blitzortung Lightning",
	controller: "blitzortung",
	device: { category: "Feeds" },
	icon: "zap",
	schema,
	config: { ttl: 30 },

	run: async (client, config, signal) => {
		const ttl = BigInt(Math.max(1, config.ttl || 30));

		console.log(`started ttl=${ttl}s`);

		receivedCount = 0n;
		publishedCount = 0n;
		errorCount = 0n;
		reconnects = 0n;

		// Strikes arrive one frame at a time; batch them so we issue one push
		// per second rather than one RPC per strike.
		let pending: Entity[] = [];
		const flush = async () => {
			if (pending.length === 0) return;
			const batch = pending;
			pending = [];
			try {
				for (let i = 0; i < batch.length; i += 200) {
					await push(client, ...batch.slice(i, i + 200));
				}
				publishedCount += BigInt(batch.length);
			} catch (err) {
				errorCount++;
				console.error("push:", err);
			}
		};
		const flushTimer = setInterval(() => { flush().catch(() => { }); }, 1000);

		const onStrike = (s: Strike) => {
			receivedCount++;
			if (s.lat == null || s.lon == null) return;

			const now = BigInt(Math.floor(Date.now() / 1000));
			const stations = s.sig?.length ?? 0;

			// `mds` is an undocumented Blitzortung field, empirically ~km-scale;
			// we read it as the location deviation in meters and carry it as an
			// isotropic positional covariance (mxx=myy=sigma², ENU/m²).
			const sigma = s.mds && s.mds > 0 ? s.mds : 0;

			pending.push(create(EntitySchema, {
				id: `blitz:${s.time}:${s.lat.toFixed(4)}_${s.lon.toFixed(4)}`,
				priority: Priority.PriorityRoutine,
				controller: create(ControllerSchema, { id: "blitzortung" }),
				geo: create(GeoSpatialComponentSchema, {
					latitude: s.lat,
					longitude: s.lon,
					...(sigma > 0 && {
						covariance: create(CovarianceMatrixSchema, { mxx: sigma * sigma, myy: sigma * sigma }),
					}),
				}),
				routing: create(RoutingSchema, { channels: [create(ChannelSchema, {})] }),
				interactivity: create(InteractivityComponentSchema, { icon: "zap" }),
				symbol: create(SymbolComponentSchema, { milStd2525C: "WAS-WSTMH-P----" }),
				classification: create(ClassificationComponentSchema, {
					identity: ClassificationIdentity.ClassificationIdentityPending,
				}),
				detection: create(DetectionComponentSchema, {
					detectorEntityId: ENTITY_ID,
					confidence: Math.min(1, stations / 20),
				}),
				lifetime: create(LifetimeSchema, {
					fresh: create(TimestampSchema, { seconds: now }),
					until: create(TimestampSchema, { seconds: now + ttl }),
				}),
			}));
		};

		// Maintain a single live connection, reconnecting until aborted.
		const connectOnce = () => new Promise<void>((resolve) => {
			const url = SERVERS[Number(reconnects % BigInt(SERVERS.length))];
			const ws = new WebSocket(url);
			let done = false;
			const finish = () => { if (!done) { done = true; connected = 0; resolve(); } };

			signal.addEventListener("abort", () => { try { ws.close(); } catch { } finish(); }, { once: true });

			ws.addEventListener("open", () => {
				connected = 1;
				console.log(`connected ${url}`);
				ws.send(JSON.stringify({ a: 111 })); // required handshake; subscribe to everything
			});
			ws.addEventListener("message", (ev: MessageEvent) => {
				let s: Strike;
				try {
					s = JSON.parse(lzwDecode(String(ev.data)));
				} catch {
					return; // keepalive / non-strike frame
				}
				onStrike(s);
			});
			ws.addEventListener("error", () => { errorCount++; try { ws.close(); } catch { } });
			ws.addEventListener("close", () => finish());
		});

		try {
			while (!signal.aborted) {
				await connectOnce();
				if (signal.aborted) break;
				reconnects++;
				console.log("disconnected — reconnecting in 3s");
				await new Promise((r) => setTimeout(r, 3000));
			}
		} finally {
			clearInterval(flushTimer);
		}
	},

	health: () => ({
		1: { label: "connected", value: connected },
		2: { label: "strikes received", value: receivedCount },
		3: { label: "strikes published", value: publishedCount },
		4: { label: "reconnects", value: reconnects },
		5: { label: "errors", value: errorCount },
	}),
});
