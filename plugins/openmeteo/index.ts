import { create, EntitySchema, EntityFilterSchema, ListEntitiesRequestSchema, EntityChange, attach, push } from "@projectqai/proto/device";
import {
	GeoSpatialComponentSchema,
	ControllerSchema,
	TrackComponentSchema,
	LifetimeSchema,
	DeviceClassOptionSchema,
	ConfigurableComponentSchema,
	ConfigurationComponentSchema,
	ClassificationComponentSchema,
	DetectionComponentSchema,
	DeviceComponentSchema,
	DeviceState,
	ConfigurableState,
	DeviceFilterSchema,
} from "@projectqai/proto/world";
import { MetricComponentSchema, MetricSchema, MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { ClassificationTaxonomySchema, EquipmentTaxonomySchema, EquipmentTaxonomySensorSchema } from "@projectqai/proto/taxonomy";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";

const ENTITY_ID = "openmeteo.service";

// -- Open-Meteo endpoints --

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood";

const WEATHER_VARS = [
	"temperature_2m",
	"relative_humidity_2m",
	"apparent_temperature",
	"precipitation",
	"rain",
	"showers",
	"snowfall",
	"cloud_cover",
	"surface_pressure",
	"pressure_msl",
	"wind_speed_10m",
	"wind_direction_10m",
	"wind_gusts_10m",
	"weather_code",
	"is_day",
] as const;

const AIR_QUALITY_VARS = [
	"european_aqi",
	"us_aqi",
	"pm10",
	"pm2_5",
	"carbon_monoxide",
	"nitrogen_dioxide",
	"sulphur_dioxide",
	"ozone",
	"dust",
	"uv_index",
	"ammonia",
	"alder_pollen",
	"birch_pollen",
	"grass_pollen",
	"mugwort_pollen",
	"olive_pollen",
	"ragweed_pollen",
] as const;

const MARINE_VARS = [
	"wave_height",
	"wave_direction",
	"wave_period",
	"wind_wave_height",
	"wind_wave_direction",
	"wind_wave_period",
	"swell_wave_height",
	"swell_wave_direction",
	"swell_wave_period",
	"ocean_current_velocity",
	"ocean_current_direction",
] as const;

// Metric IDs — weather 1-19, air quality 20-39, marine 40-59, flood 60+
const MID_TEMPERATURE       = 1;
const MID_HUMIDITY          = 2;
const MID_APPARENT_TEMP     = 3;
const MID_PRECIPITATION     = 4;
const MID_RAIN              = 5;
const MID_SHOWERS           = 6;
const MID_SNOWFALL          = 7;
const MID_CLOUD_COVER       = 8;
const MID_SURFACE_PRESSURE  = 9;
const MID_SEA_LEVEL_PRESSURE = 10;
const MID_WIND_SPEED        = 11;
const MID_WIND_DIR          = 12;
const MID_WIND_GUSTS        = 13;

const MID_EU_AQI            = 20;
const MID_US_AQI            = 21;
const MID_PM10              = 22;
const MID_PM25              = 23;
const MID_CO                = 24;
const MID_NO2               = 25;
const MID_SO2               = 26;
const MID_OZONE             = 27;
const MID_DUST              = 28;
const MID_UV_INDEX          = 29;
const MID_AMMONIA           = 30;
const MID_POLLEN_ALDER      = 31;
const MID_POLLEN_BIRCH      = 32;
const MID_POLLEN_GRASS      = 33;
const MID_POLLEN_MUGWORT    = 34;
const MID_POLLEN_OLIVE      = 35;
const MID_POLLEN_RAGWEED    = 36;

const MID_WAVE_HEIGHT       = 40;
const MID_WAVE_DIR          = 41;
const MID_WAVE_PERIOD       = 42;
const MID_WIND_WAVE_HEIGHT  = 43;
const MID_WIND_WAVE_DIR     = 44;
const MID_WIND_WAVE_PERIOD  = 45;
const MID_SWELL_HEIGHT      = 46;
const MID_SWELL_DIR         = 47;
const MID_SWELL_PERIOD      = 48;
const MID_OCEAN_CURRENT_VEL = 49;
const MID_OCEAN_CURRENT_DIR = 50;

const MID_RIVER_DISCHARGE   = 60;

// -- WMO weather codes --

const WMO_DESCRIPTIONS: Record<number, string> = {
	0: "Clear sky",
	1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
	45: "Fog", 48: "Depositing rime fog",
	51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
	56: "Light freezing drizzle", 57: "Dense freezing drizzle",
	61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
	66: "Light freezing rain", 67: "Heavy freezing rain",
	71: "Slight snowfall", 73: "Moderate snowfall", 75: "Heavy snowfall",
	77: "Snow grains",
	80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
	85: "Slight snow showers", 86: "Heavy snow showers",
	95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

// -- API response types --

interface WeatherCurrent {
	temperature_2m: number;
	relative_humidity_2m: number;
	apparent_temperature: number;
	precipitation: number;
	rain: number;
	showers: number;
	snowfall: number;
	cloud_cover: number;
	surface_pressure: number;
	pressure_msl: number;
	wind_speed_10m: number;
	wind_direction_10m: number;
	wind_gusts_10m: number;
	weather_code: number;
	is_day: number;
}

interface AirQualityCurrent {
	european_aqi?: number;
	us_aqi?: number;
	pm10?: number;
	pm2_5?: number;
	carbon_monoxide?: number;
	nitrogen_dioxide?: number;
	sulphur_dioxide?: number;
	ozone?: number;
	dust?: number;
	uv_index?: number;
	ammonia?: number;
	alder_pollen?: number;
	birch_pollen?: number;
	grass_pollen?: number;
	mugwort_pollen?: number;
	olive_pollen?: number;
	ragweed_pollen?: number;
}

interface MarineCurrent {
	wave_height?: number;
	wave_direction?: number;
	wave_period?: number;
	wind_wave_height?: number;
	wind_wave_direction?: number;
	wind_wave_period?: number;
	swell_wave_height?: number;
	swell_wave_direction?: number;
	swell_wave_period?: number;
	ocean_current_velocity?: number;
	ocean_current_direction?: number;
}

interface FloodDaily {
	time: string[];
	river_discharge: number[];
}

// -- Helpers --

function m(id: number, label: string, kind: number, unit: number, value: number | null | undefined) {
	if (value == null || isNaN(value)) return null;
	return create(MetricSchema, { id, label, kind, unit, val: { case: "float", value } });
}

function buildWeatherMetrics(w: WeatherCurrent) {
	return [
		m(MID_TEMPERATURE,        "Temperature",        MetricKind.MetricKindTemperature,    MetricUnit.MetricUnitCelsius,           w.temperature_2m),
		m(MID_HUMIDITY,           "Humidity",            MetricKind.MetricKindHumidity,       MetricUnit.MetricUnitPercent,           w.relative_humidity_2m),
		m(MID_APPARENT_TEMP,      "Feels like",          MetricKind.MetricKindTemperature,    MetricUnit.MetricUnitCelsius,           w.apparent_temperature),
		m(MID_PRECIPITATION,      "Precipitation",       MetricKind.MetricKindPrecipitation,  MetricUnit.MetricUnitMillimeter,        w.precipitation),
		m(MID_RAIN,               "Rain",                MetricKind.MetricKindPrecipitation,  MetricUnit.MetricUnitMillimeter,        w.rain),
		m(MID_SHOWERS,            "Showers",             MetricKind.MetricKindPrecipitation,  MetricUnit.MetricUnitMillimeter,        w.showers),
		m(MID_SNOWFALL,           "Snowfall",            MetricKind.MetricKindPrecipitation,  MetricUnit.MetricUnitMillimeter,        w.snowfall),
		m(MID_CLOUD_COVER,        "Cloud cover",         MetricKind.MetricKindPercentage,     MetricUnit.MetricUnitPercent,           w.cloud_cover),
		m(MID_SURFACE_PRESSURE,   "Surface pressure",    MetricKind.MetricKindPressure,       MetricUnit.MetricUnitHectopascal,       w.surface_pressure),
		m(MID_SEA_LEVEL_PRESSURE, "Sea-level pressure",  MetricKind.MetricKindPressure,       MetricUnit.MetricUnitHectopascal,       w.pressure_msl),
		m(MID_WIND_SPEED,         "Wind speed",          MetricKind.MetricKindWindSpeed,      MetricUnit.MetricUnitKilometerPerHour,  w.wind_speed_10m),
		m(MID_WIND_DIR,           "Wind direction",      MetricKind.MetricKindWindDirection,  MetricUnit.MetricUnitDegree,            w.wind_direction_10m),
		m(MID_WIND_GUSTS,         "Wind gusts",          MetricKind.MetricKindWindSpeed,      MetricUnit.MetricUnitKilometerPerHour,  w.wind_gusts_10m),
	].filter(v => v != null);
}

function buildAirQualityMetrics(a: AirQualityCurrent) {
	return [
		m(MID_EU_AQI,        "European AQI",      MetricKind.MetricKindAqi,            MetricUnit.MetricUnitUnspecified,              a.european_aqi),
		m(MID_US_AQI,        "US AQI",            MetricKind.MetricKindAqi,            MetricUnit.MetricUnitUnspecified,              a.us_aqi),
		m(MID_PM10,          "PM10",              MetricKind.MetricKindPm10,           MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.pm10),
		m(MID_PM25,          "PM2.5",             MetricKind.MetricKindPm25,           MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.pm2_5),
		m(MID_CO,            "CO",                MetricKind.MetricKindChemicalHazard, MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.carbon_monoxide),
		m(MID_NO2,           "NO₂",          MetricKind.MetricKindChemicalHazard, MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.nitrogen_dioxide),
		m(MID_SO2,           "SO₂",          MetricKind.MetricKindChemicalHazard, MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.sulphur_dioxide),
		m(MID_OZONE,         "Ozone",             MetricKind.MetricKindChemicalHazard, MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.ozone),
		m(MID_DUST,          "Dust",              MetricKind.MetricKindPm10,           MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.dust),
		m(MID_UV_INDEX,      "UV index",          MetricKind.MetricKindIrradiance,     MetricUnit.MetricUnitUnspecified,              a.uv_index),
		m(MID_AMMONIA,       "Ammonia",           MetricKind.MetricKindChemicalHazard, MetricUnit.MetricUnitMicrogramPerCubicMeter,   a.ammonia),
		m(MID_POLLEN_ALDER,  "Pollen (Alder)",    MetricKind.MetricKindBiologicalHazard, MetricUnit.MetricUnitUnspecified,           a.alder_pollen),
		m(MID_POLLEN_BIRCH,  "Pollen (Birch)",    MetricKind.MetricKindBiologicalHazard, MetricUnit.MetricUnitUnspecified,           a.birch_pollen),
		m(MID_POLLEN_GRASS,  "Pollen (Grass)",    MetricKind.MetricKindBiologicalHazard, MetricUnit.MetricUnitUnspecified,           a.grass_pollen),
		m(MID_POLLEN_MUGWORT,"Pollen (Mugwort)",  MetricKind.MetricKindBiologicalHazard, MetricUnit.MetricUnitUnspecified,           a.mugwort_pollen),
		m(MID_POLLEN_OLIVE,  "Pollen (Olive)",    MetricKind.MetricKindBiologicalHazard, MetricUnit.MetricUnitUnspecified,           a.olive_pollen),
		m(MID_POLLEN_RAGWEED,"Pollen (Ragweed)",  MetricKind.MetricKindBiologicalHazard, MetricUnit.MetricUnitUnspecified,           a.ragweed_pollen),
	].filter(v => v != null);
}

function buildMarineMetrics(ma: MarineCurrent) {
	return [
		m(MID_WAVE_HEIGHT,       "Wave height",        MetricKind.MetricKindDepth,          MetricUnit.MetricUnitMeter,              ma.wave_height),
		m(MID_WAVE_DIR,          "Wave direction",      MetricKind.MetricKindWindDirection,  MetricUnit.MetricUnitDegree,             ma.wave_direction),
		m(MID_WAVE_PERIOD,       "Wave period",         MetricKind.MetricKindDuration,       MetricUnit.MetricUnitSecond,             ma.wave_period),
		m(MID_WIND_WAVE_HEIGHT,  "Wind wave height",    MetricKind.MetricKindDepth,          MetricUnit.MetricUnitMeter,              ma.wind_wave_height),
		m(MID_WIND_WAVE_DIR,     "Wind wave direction", MetricKind.MetricKindWindDirection,  MetricUnit.MetricUnitDegree,             ma.wind_wave_direction),
		m(MID_WIND_WAVE_PERIOD,  "Wind wave period",    MetricKind.MetricKindDuration,       MetricUnit.MetricUnitSecond,             ma.wind_wave_period),
		m(MID_SWELL_HEIGHT,      "Swell height",        MetricKind.MetricKindDepth,          MetricUnit.MetricUnitMeter,              ma.swell_wave_height),
		m(MID_SWELL_DIR,         "Swell direction",     MetricKind.MetricKindWindDirection,  MetricUnit.MetricUnitDegree,             ma.swell_wave_direction),
		m(MID_SWELL_PERIOD,      "Swell period",        MetricKind.MetricKindDuration,       MetricUnit.MetricUnitSecond,             ma.swell_wave_period),
		m(MID_OCEAN_CURRENT_VEL, "Ocean current",       MetricKind.MetricKindSpeed,          MetricUnit.MetricUnitKilometerPerHour,   ma.ocean_current_velocity),
		m(MID_OCEAN_CURRENT_DIR, "Ocean current dir",   MetricKind.MetricKindWindDirection,  MetricUnit.MetricUnitDegree,             ma.ocean_current_direction),
	].filter(v => v != null);
}

function detectHazards(w?: WeatherCurrent | null, a?: AirQualityCurrent | null): string[] {
	const hazards: string[] = [];
	if (w) {
		if (w.weather_code >= 95) hazards.push("Thunderstorm");
		if (w.wind_gusts_10m >= 80) hazards.push("Severe wind gusts");
		if (w.snowfall > 5) hazards.push("Heavy snowfall");
	}
	if (a) {
		if (a.european_aqi != null && a.european_aqi > 100) hazards.push("Poor air quality");
		if (a.us_aqi != null && a.us_aqi > 150) hazards.push("Unhealthy air quality");
		if (a.pm2_5 != null && a.pm2_5 > 35) hazards.push("High PM2.5");
		if (a.pm10 != null && a.pm10 > 50) hazards.push("High PM10");
		if (a.ozone != null && a.ozone > 180) hazards.push("High ozone");
		if (a.nitrogen_dioxide != null && a.nitrogen_dioxide > 200) hazards.push("High NO₂");
		if (a.sulphur_dioxide != null && a.sulphur_dioxide > 350) hazards.push("High SO₂");
		if (a.carbon_monoxide != null && a.carbon_monoxide > 10000) hazards.push("High CO");
		if (a.uv_index != null && a.uv_index >= 8) hazards.push("Very high UV");
	}
	return hazards;
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
		if ((err as Error)?.name === "AbortError") throw err;
		console.error(`fetch ${url}:`, err);
		return null;
	}
}

async function fetchWeather(lat: number, lon: number, signal: AbortSignal) {
	const params = new URLSearchParams({
		latitude: lat.toString(),
		longitude: lon.toString(),
		current: WEATHER_VARS.join(","),
		wind_speed_unit: "kmh",
		timezone: "auto",
	});
	return fetchJSON<{ current: WeatherCurrent }>(`${WEATHER_URL}?${params}`, signal);
}

async function fetchAirQuality(lat: number, lon: number, signal: AbortSignal) {
	const params = new URLSearchParams({
		latitude: lat.toString(),
		longitude: lon.toString(),
		current: AIR_QUALITY_VARS.join(","),
		timezone: "auto",
	});
	return fetchJSON<{ current: AirQualityCurrent }>(`${AIR_QUALITY_URL}?${params}`, signal);
}

async function fetchMarine(lat: number, lon: number, signal: AbortSignal) {
	const params = new URLSearchParams({
		latitude: lat.toString(),
		longitude: lon.toString(),
		current: MARINE_VARS.join(","),
		timezone: "auto",
	});
	return fetchJSON<{ current: MarineCurrent }>(`${MARINE_URL}?${params}`, signal);
}

async function fetchFlood(lat: number, lon: number, signal: AbortSignal) {
	const params = new URLSearchParams({
		latitude: lat.toString(),
		longitude: lon.toString(),
		daily: "river_discharge",
		forecast_days: "1",
	});
	return fetchJSON<{ daily: FloodDaily }>(`${FLOOD_URL}?${params}`, signal);
}

// -- State --

interface TrackedStation {
	id: string;
	baseLabel: string;
	lat: number;
	lon: number;
}

let stationCount = 0;
let pollCount = 0n;
let errorCount = 0n;
let lastPollMs = 0;

const schema = {
	pollInterval: {
		type: "integer",
		title: "Poll Interval",
		description: "Seconds between weather updates",
		default: 600,
		"ui:widget": "stepper",
		"ui:order": 0,
	},
} as const;

await attach({
	id: ENTITY_ID,
	label: "Open-Meteo Weather",
	controller: "openmeteo",
	device: { category: "Feeds" },
	icon: "cloud-sun",
	schema,
	config: { pollInterval: 600 },

	run: async (client, config, signal) => {
		await push(client, create(EntitySchema, {
			id: ENTITY_ID,
			configurable: create(ConfigurableComponentSchema, {
				schema: { type: "object", properties: schema } as any,
				supportedDeviceClasses: [
					create(DeviceClassOptionSchema, {
						class: "weather_station",
						label: "Weather",
						description: "Fetches weather, air quality, marine, and flood data for a map position",
					}),
				],
			}),
		}));
		const interval = Math.max(60, config.pollInterval || 600) * 1000;
		const stations = new Map<string, TrackedStation>();

		console.log(`started interval=${interval / 1000}s`);

		pollCount = 0n;
		errorCount = 0n;

		const pollStation = async (station: TrackedStation) => {
			const { lat, lon, id } = station;

			const [weather, airQuality, marine, flood] = await Promise.all([
				fetchWeather(lat, lon, signal),
				fetchAirQuality(lat, lon, signal),
				fetchMarine(lat, lon, signal),
				fetchFlood(lat, lon, signal),
			]);

			const metrics = [];

			if (weather?.current) {
				metrics.push(...buildWeatherMetrics(weather.current));
			}
			if (airQuality?.current) {
				metrics.push(...buildAirQualityMetrics(airQuality.current));
			}
			if (marine?.current) {
				metrics.push(...buildMarineMetrics(marine.current));
			}
			if (flood?.daily?.river_discharge?.length) {
				const discharge = flood.daily.river_discharge[0];
				const rv = m(MID_RIVER_DISCHARGE, "River discharge", MetricKind.MetricKindVolumeFlowRate, MetricUnit.MetricUnitCubicMeterPerHour, discharge);
				if (rv) metrics.push(rv);
			}

			if (metrics.length === 0) {
				errorCount++;
				return;
			}

			const weatherCode = weather?.current?.weather_code;
			const weatherDesc = weatherCode != null ? (WMO_DESCRIPTIONS[weatherCode] ?? `WMO ${weatherCode}`) : "No data";
			const temp = weather?.current?.temperature_2m;

			let label = `${station.baseLabel}: ${weatherDesc}`;
			if (temp != null) label += `, ${temp}°C`;

			const ttlSec = BigInt(Math.floor(interval * 2 / 1000));

			const entity = create(EntitySchema, {
				id,
				label,
				metric: create(MetricComponentSchema, { metrics }),
				lifetime: create(LifetimeSchema, {
					until: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1000)) + ttlSec }),
				}),
			});

			const hazards = detectHazards(weather?.current, airQuality?.current);
			if (hazards.length > 0) {
				entity.detection = create(DetectionComponentSchema, {
					detectorEntityId: ENTITY_ID,
					confidence: 1.0,
				});
			}

			await push(client, entity);
		};

		const pollAll = async () => {
			if (stations.size === 0) return;
			pollCount++;
			const t0 = performance.now();

			await Promise.all(
				[...stations.values()].map(s =>
					pollStation(s).catch(err => {
						if ((err as Error)?.name === "AbortError") throw err;
						errorCount++;
						console.error(`poll ${s.id}:`, err);
					}),
				),
			);

			lastPollMs = performance.now() - t0;
			console.log(`polled ${stations.size} stations in ${Math.round(lastPollMs)}ms`);
		};

		// Watch for child entities (weather stations placed by the user)
		const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
			filter: create(EntityFilterSchema, {
				device: create(DeviceFilterSchema, {
					parent: ENTITY_ID,
				}),
			}),
		}), { signal });

		let pollTimer: ReturnType<typeof setInterval> | null = null;

		const restartTimer = () => {
			if (pollTimer) clearInterval(pollTimer);
			pollTimer = setInterval(() => {
				pollAll().catch(err => {
					if ((err as Error)?.name !== "AbortError") {
						errorCount++;
						console.error("poll error:", err);
					}
				});
			}, interval);
		};

		signal.addEventListener("abort", () => { if (pollTimer) clearInterval(pollTimer); }, { once: true });

		const initialized = new Set<string>();

		for await (const event of stream) {
			if (!event.entity) continue;

			if (event.t === EntityChange.EntityChangeUpdated) {
				const e = event.entity;

				if (!initialized.has(e.id)) {
					initialized.add(e.id);
					console.log(`initializing station: ${e.id}`);
					await push(client, create(EntitySchema, {
						id: e.id,
						label: e.label || "Weather",
						controller: create(ControllerSchema, { id: "openmeteo" }),
						device: create(DeviceComponentSchema, { parent: ENTITY_ID, state: DeviceState.DeviceStateActive }),
						track: create(TrackComponentSchema, { tracker: ENTITY_ID }),
						classification: create(ClassificationComponentSchema, {
							taxonomy: [
								create(ClassificationTaxonomySchema, {
									kind: { case: "equipment", value: create(EquipmentTaxonomySchema, {
										sensor: create(EquipmentTaxonomySensorSchema, {}),
									}) },
								}),
							],
						}),
						configurable: create(ConfigurableComponentSchema, {
							schema: { type: "object", properties: {} } as any,
							state: ConfigurableState.ConfigurableStateActive,
						}),
						config: create(ConfigurationComponentSchema, {
							value: {},
						}),
					}));
				}

				const geo = e.geo;
				if (!geo || (geo.latitude === 0 && geo.longitude === 0)) continue;

				const existing = stations.get(e.id);

				if (!existing) {
					console.log(`station positioned: ${e.id} at ${geo.latitude}, ${geo.longitude}`);
					stations.set(e.id, { id: e.id, baseLabel: "Weather", lat: geo.latitude, lon: geo.longitude });
					stationCount = stations.size;

					pollStation(stations.get(e.id)!).catch(err => {
						if ((err as Error)?.name !== "AbortError") {
							errorCount++;
							console.error(`initial poll ${e.id}:`, err);
						}
					});

					if (!pollTimer) restartTimer();
				} else if (existing.lat !== geo.latitude || existing.lon !== geo.longitude) {
					console.log(`station moved: ${e.id} to ${geo.latitude}, ${geo.longitude}`);
					existing.lat = geo.latitude;
					existing.lon = geo.longitude;

					pollStation(existing).catch(err => {
						if ((err as Error)?.name !== "AbortError") {
							errorCount++;
							console.error(`moved poll ${e.id}:`, err);
						}
					});
				}
			} else if (event.t === EntityChange.EntityChangeExpired || event.t === EntityChange.EntityChangeUnobserved) {
				initialized.delete(event.entity.id);
				if (stations.delete(event.entity.id)) {
					console.log(`station removed: ${event.entity.id}`);
					stationCount = stations.size;
					if (stations.size === 0 && pollTimer) {
						clearInterval(pollTimer);
						pollTimer = null;
					}
				}
			}
		}
	},

	health: () => ({
		1: { label: "stations", value: stationCount },
		2: { label: "polls", value: pollCount },
		3: { label: "errors", value: errorCount },
		4: { label: "last poll ms", value: lastPollMs },
	}),
});
