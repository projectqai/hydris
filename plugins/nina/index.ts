import { create, EntitySchema, attach, push } from "@projectqai/proto/device";
import {
	GeoSpatialComponentSchema,
	GeoShapeComponentSchema,
	GeometrySchema,
	ControllerSchema,
	TrackComponentSchema,
	LifetimeSchema,
	RoutingSchema,
	ChannelSchema,
	NavigationComponentSchema,
	NavigationMode,
	AdministrativeComponentSchema,
	ClassificationComponentSchema,
	ClassificationIdentity,
	MissionComponentSchema,
	Priority,
} from "@projectqai/proto/world";
import {
	PlanarGeometrySchema,
	PlanarPolygonSchema,
	PlanarRingSchema,
	PlanarPointSchema,
} from "@projectqai/proto/geometry";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";

const BASE_URL = "https://warnung.bund.de/api31";
const ENTITY_ID = "nina.service";

const PROVIDERS = ["mowas", "biwapp", "katwarn", "dwd", "lhp", "police"] as const;
type Provider = (typeof PROVIDERS)[number];

interface MapWarning {
	id: string;
	version: number;
	startDate: string;
	severity: string;
	type: string;
	i18nTitle?: Record<string, string>;
}

interface WarningInfo {
	category: string[];
	event: string;
	urgency: string;
	severity: string;
	certainty: string;
	effective?: string;
	expires?: string;
	senderName?: string;
	headline?: string;
	description?: string;
	web?: string;
	area?: { areaDesc: string; geocode?: { valueName: string; value: string }[] }[];
}

interface WarningDetail {
	identifier: string;
	sender: string;
	sent: string;
	status: string;
	msgType: string;
	info?: WarningInfo[];
}

type GeoJSONGeometry =
	| { type: "Polygon"; coordinates: number[][][] }
	| { type: "MultiPolygon"; coordinates: number[][][][] }
	| { type: "GeometryCollection"; geometries: GeoJSONGeometry[] }
	| { type: string; coordinates?: any };

interface GeoJSONObject {
	type: string;
	geometry?: GeoJSONGeometry;
	geometries?: GeoJSONGeometry[];
	features?: { geometry?: GeoJSONGeometry }[];
}

async function sanitizeHTML(html: string): Promise<string> {
	let text = "";
	const rewriter = new HTMLRewriter()
		.on("br", { element() { text += "\n"; } })
		.on("*", { text(chunk) { text += chunk.text; } });
	await rewriter.transform(new Response(html)).text();
	return text.replace(/\n{3,}/g, "\n\n").trim();
}

function severityToPriority(severity: string): Priority {
	switch (severity?.toLowerCase()) {
		case "extreme": return Priority.PriorityFlash;
		case "severe":  return Priority.PriorityImmediate;
		case "moderate": return Priority.PriorityImmediate;
		case "minor":   return Priority.PriorityRoutine;
		default:        return Priority.PriorityRoutine;
	}
}

function severityToIdentity(severity: string): ClassificationIdentity {
	switch (severity?.toLowerCase()) {
		case "extreme": return ClassificationIdentity.ClassificationIdentityHostile;
		case "severe":  return ClassificationIdentity.ClassificationIdentitySuspect;
		case "moderate": return ClassificationIdentity.ClassificationIdentityNeutral;
		case "minor":   return ClassificationIdentity.ClassificationIdentityFriend;
		default:        return ClassificationIdentity.ClassificationIdentityUnknown;
	}
}

function collectPolygons(geo: GeoJSONGeometry): number[][][][] {
	switch (geo.type) {
		case "Polygon":
			return [geo.coordinates as number[][][]];
		case "MultiPolygon":
			return geo.coordinates as number[][][][];
		case "GeometryCollection":
			return (geo.geometries || []).flatMap(collectPolygons);
		default:
			return [];
	}
}

function extractPolygons(geoJSON: GeoJSONObject): number[][][][] {
	if (geoJSON.type === "FeatureCollection" && geoJSON.features) {
		return geoJSON.features.flatMap(f => f.geometry ? collectPolygons(f.geometry) : []);
	}
	if (geoJSON.type === "Feature" && geoJSON.geometry) {
		return collectPolygons(geoJSON.geometry);
	}
	return collectPolygons(geoJSON as GeoJSONGeometry);
}

function ringToProto(coords: number[][]) {
	return create(PlanarRingSchema, {
		points: coords.map(([lon, lat]) => create(PlanarPointSchema, { longitude: lon, latitude: lat })),
	});
}

function polygonToProto(rings: number[][][]) {
	if (rings.length === 0) return null;
	return create(PlanarPolygonSchema, {
		outer: ringToProto(rings[0]),
		holes: rings.slice(1).map(ringToProto),
	});
}

function centroid(polygons: number[][][][]): { lat: number; lon: number } | null {
	let sumLat = 0, sumLon = 0, count = 0;
	for (const poly of polygons) {
		for (const [lon, lat] of poly[0] || []) {
			sumLon += lon;
			sumLat += lat;
			count++;
		}
	}
	if (count === 0) return null;
	return { lat: sumLat / count, lon: sumLon / count };
}

async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T | null> {
	try {
		const resp = await fetch(url, { signal });
		if (!resp.ok) {
			console.error(`fetch ${url}: HTTP ${resp.status}`);
			return null;
		}
		return await resp.json() as T;
	} catch (err) {
		console.error(`fetch ${url}:`, err);
		return null;
	}
}

type Config = {
	pollInterval?: number;
	mowas?: boolean;
	biwapp?: boolean;
	katwarn?: boolean;
	dwd?: boolean;
	lhp?: boolean;
	police?: boolean;
};

const schema = {
	pollInterval: {
		type: "integer",
		title: "Poll Interval",
		description: "Seconds between API polls",
		default: 120,
		"ui:widget": "stepper",
		"ui:order": 0,
	},
	mowas: {
		type: "boolean",
		title: "MoWaS",
		description: "Modulares Warnsystem (civil protection)",
		default: true,
		"ui:group": "providers",
		"ui:order": 0,
	},
	biwapp: {
		type: "boolean",
		title: "BIWAPP",
		description: "Bürger Info- & Warn-App",
		default: true,
		"ui:group": "providers",
		"ui:order": 1,
	},
	katwarn: {
		type: "boolean",
		title: "KATWARN",
		description: "Katastrophen-Warnung",
		default: true,
		"ui:group": "providers",
		"ui:order": 2,
	},
	dwd: {
		type: "boolean",
		title: "DWD",
		description: "Deutscher Wetterdienst (weather warnings)",
		default: true,
		"ui:group": "providers",
		"ui:order": 3,
	},
	lhp: {
		type: "boolean",
		title: "Hochwasserportal",
		description: "Länderübergreifendes Hochwasserportal (flood warnings)",
		default: true,
		"ui:group": "providers",
		"ui:order": 4,
	},
	police: {
		type: "boolean",
		title: "Police",
		description: "Polizeimeldungen",
		default: false,
		"ui:group": "providers",
		"ui:order": 5,
	},
} as const;

let warningCount = 0;
let pollCount = 0n;
let pushCount = 0n;
let errorCount = 0n;
let lastPollMs = 0;

await attach({
	id: ENTITY_ID,
	label: "NINA Warnungen",
	controller: "nina",
	device: { category: "Feeds" },
	icon: "alert-triangle",
	schema,
	config: {
		pollInterval: 120,
		mowas: true,
		biwapp: true,
		katwarn: true,
		dwd: true,
		lhp: true,
		police: false,
	},

	run: async (client, config, signal) => {
		const cfg = config as Config;
		const interval = Math.max(30, cfg.pollInterval || 120) * 1000;
		const enabledProviders = PROVIDERS.filter(p => cfg[p] !== false);

		console.log(`started providers=[${enabledProviders}] interval=${interval / 1000}s`);

		warningCount = 0;
		pollCount = 0n;
		pushCount = 0n;
		errorCount = 0n;

		const poll = async () => {
			pollCount++;
			const t0 = performance.now();

			const allWarnings = new Map<string, { warning: MapWarning; provider: Provider }>();

			const mapResults = await Promise.all(
				enabledProviders.map(async p => {
					const data = await fetchJSON<MapWarning[]>(`${BASE_URL}/${p}/mapData.json`, signal);
					return { provider: p, warnings: data || [] };
				}),
			);

			for (const { provider, warnings } of mapResults) {
				for (const w of warnings) {
					if (w.type === "Cancel") continue;
					if (!allWarnings.has(w.id)) {
						allWarnings.set(w.id, { warning: w, provider });
					}
				}
			}

			const entities = [];

			for (const [id, { warning, provider }] of allWarnings) {
				const [detail, geoJSON] = await Promise.all([
					fetchJSON<WarningDetail>(`${BASE_URL}/warnings/${id}.json`, signal),
					fetchJSON<GeoJSONObject>(`${BASE_URL}/warnings/${id}.geojson`, signal),
				]);

				const info = detail?.info?.[0];
				const headline = info?.headline || warning.i18nTitle?.de || id;
				const severity = info?.severity || warning.severity || "Unknown";

				const entity = create(EntitySchema, {
					id: `nina:${id}`,
					label: headline,
					priority: severityToPriority(severity),
					controller: create(ControllerSchema, { id: "nina" }),
					track: create(TrackComponentSchema, { tracker: ENTITY_ID }),
					routing: create(RoutingSchema, { channels: [create(ChannelSchema, {})] }),
					navigation: create(NavigationComponentSchema, {
						mode: NavigationMode.NavigationModeStationary,
					}),
				});

				entity.classification = create(ClassificationComponentSchema, {
					identity: severityToIdentity(severity),
				});

				if (info?.description) {
					entity.mission = create(MissionComponentSchema, {
						description: await sanitizeHTML(info.description),
					});
				}

				if (info?.senderName) {
					entity.administrative = create(AdministrativeComponentSchema, {
						owner: info.senderName,
						manufacturer: provider.toUpperCase(),
					});
				}

				const ttlSec = BigInt(Math.floor(interval * 2 / 1000));
				entity.lifetime = create(LifetimeSchema, {
					until: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1000)) + ttlSec }),
				});

				if (geoJSON) {
					const polygons = extractPolygons(geoJSON);
					const center = centroid(polygons);

					if (center) {
						entity.geo = create(GeoSpatialComponentSchema, {
							latitude: center.lat,
							longitude: center.lon,
						});
					}

					if (polygons.length > 0) {
						const first = polygonToProto(polygons[0]);
						if (first) {
							entity.shape = create(GeoShapeComponentSchema, {
								geometry: create(GeometrySchema, {
									planar: create(PlanarGeometrySchema, {
										plane: { case: "polygon", value: first },
									}),
								}),
							});
						}
					}
				}

				entities.push(entity);
			}

			warningCount = entities.length;

			for (let i = 0; i < entities.length; i += 200) {
				pushCount++;
				try {
					await push(client, ...entities.slice(i, i + 200));
				} catch (err) {
					errorCount++;
					console.error("push:", err);
				}
			}

			lastPollMs = performance.now() - t0;
			console.log(`polled ${enabledProviders.length} providers: ${warningCount} warnings in ${Math.round(lastPollMs)}ms`);
		};

		await poll();

		await new Promise<void>((resolve) => {
			const timer = setInterval(() => {
				poll().catch(err => {
					errorCount++;
					console.error("poll error:", err);
				});
			}, interval);
			signal.addEventListener("abort", () => { clearInterval(timer); resolve(); }, { once: true });
		});
	},

	health: () => ({
		1: { label: "active warnings", value: warningCount },
		2: { label: "polls", value: pollCount },
		3: { label: "pushes", value: pushCount },
		4: { label: "errors", value: errorCount },
		5: { label: "last poll ms", value: lastPollMs },
	}),
});
