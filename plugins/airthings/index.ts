/// <reference types="@projectqai/hal" />
import { create, EntitySchema, EntityFilterSchema, ListEntitiesRequestSchema, EntityChange, attach, push } from "@projectqai/proto/device";
import { MetricComponentSchema, MetricSchema, MetricRangeSchema, MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { DeviceFilterSchema, BleDeviceFilterSchema, DeviceComponentSchema, DeviceState, ControllerSchema, AdministrativeComponentSchema, SymbolComponentSchema, LinkComponentSchema, LinkStatus } from "@projectqai/proto/world";
import { SERVICE_UUIDS, CHAR_MODEL_NUMBER, MODEL_NAMES, readSensors, type DeviceModel, type SensorReadings } from "./protocol";

interface TrackedDevice {
	address: string;
	model?: DeviceModel;
	registered?: boolean;
	rssiDbm?: number;
}

function entityId(dev: TrackedDevice) {
	return `airthings.device.${dev.address.replace(/:/g, "")}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
	});
}

// -- Metrics --

const MID_TEMPERATURE = 1, MID_HUMIDITY = 2, MID_PRESSURE = 3, MID_CO2 = 4;
const MID_VOC = 5, MID_RADON_1DAY = 6, MID_RADON_LONG = 7, MID_ILLUMINANCE = 8;

function buildMetrics(r: SensorReadings) {
	const m = [];
	if (r.temperature !== undefined) m.push(create(MetricSchema, { id: MID_TEMPERATURE, label: "Temperature", kind: MetricKind.MetricKindTemperature, unit: MetricUnit.MetricUnitCelsius, val: { case: "float", value: r.temperature } }));
	if (r.humidity !== undefined) m.push(create(MetricSchema, { id: MID_HUMIDITY, label: "Humidity", kind: MetricKind.MetricKindHumidity, unit: MetricUnit.MetricUnitPercent, val: { case: "float", value: r.humidity } }));
	if (r.pressure !== undefined) m.push(create(MetricSchema, { id: MID_PRESSURE, label: "Pressure", kind: MetricKind.MetricKindPressure, unit: MetricUnit.MetricUnitMillibar, val: { case: "float", value: r.pressure } }));
	if (r.co2 !== undefined) m.push(create(MetricSchema, { id: MID_CO2, label: "CO\u2082", kind: MetricKind.MetricKindCo2, unit: MetricUnit.MetricUnitPartsPerMillion, val: { case: "float", value: r.co2 } }));
	if (r.voc !== undefined) m.push(create(MetricSchema, { id: MID_VOC, label: "VOC", kind: MetricKind.MetricKindChemicalHazard, unit: MetricUnit.MetricUnitPartsPerBillion, range: create(MetricRangeSchema, { max: { case: "maxFloat", value: 65534 } }), val: { case: "float", value: r.voc } }));
	if (r.radon1day !== undefined) m.push(create(MetricSchema, { id: MID_RADON_1DAY, label: "Radon (1-day avg) Bq/m\u00b3", kind: MetricKind.MetricKindRadiationHazard, unit: MetricUnit.MetricUnitUnspecified, val: { case: "float", value: r.radon1day } }));
	if (r.radonLongterm !== undefined) m.push(create(MetricSchema, { id: MID_RADON_LONG, label: "Radon (long-term) Bq/m\u00b3", kind: MetricKind.MetricKindRadiationHazard, unit: MetricUnit.MetricUnitUnspecified, val: { case: "float", value: r.radonLongterm } }));
	if (r.illuminance !== undefined) m.push(create(MetricSchema, { id: MID_ILLUMINANCE, label: "Illuminance", kind: MetricKind.MetricKindIlluminance, unit: MetricUnit.MetricUnitPercent, val: { case: "float", value: r.illuminance / 2.55 } }));
	return m;
}

// -- State --

let deviceCount = 0, pollCount = 0n, lastPollMs = 0;

// -- Main --

await attach({
	id: "airthings.service",
	label: "Airthings",
	controller: "airthings",
	device: { category: "Sensors" },
	icon: "wind",
	schema: {
		pollInterval: {
			type: "integer",
			title: "Poll Interval",
			description: "Seconds between sensor reads",
			default: 300,
			"ui:widget": "stepper",
		},
	} as const,
	config: { pollInterval: 300 },

	run: async (client, config, signal) => {
		const tracked = new Map<string, TrackedDevice>();
		const interval = (config.pollInterval ?? 300) * 1000;

		const pollDevice = async (dev: TrackedDevice) => {
			const id = entityId(dev);
			const ble = Hydris.bluetooth.requestDevice(dev.address);
			const server = await ble.gatt.connect();

			try {
				if (!dev.model) {
					const dis = await server.getPrimaryService("0000180a-0000-1000-8000-00805f9b34fb");
					const buf = await (await dis.getCharacteristic(CHAR_MODEL_NUMBER)).readValue();
					dev.model = new TextDecoder().decode(buf).trim() as DeviceModel;
					console.log(`${id}: model ${dev.model}`);
				}

				if (!dev.registered) {
					await push(client, create(EntitySchema, {
						id,
						label: MODEL_NAMES[dev.model] ?? `Airthings ${dev.model}`,
						symbol: create(SymbolComponentSchema, { milStd2525C: "SNGPESE---*****" }),
						controller: create(ControllerSchema, { id: "airthings" }),
						device: create(DeviceComponentSchema, { parent: "airthings.service", category: "Sensors", state: DeviceState.DeviceStateActive }),
						administrative: create(AdministrativeComponentSchema, { manufacturer: "Airthings", model: dev.model }),
					}));
					dev.registered = true;
				}

				const readings = await readSensors(server, dev.model);
				const metrics = buildMetrics(readings);

				if (metrics.length > 0) {
					await push(client, create(EntitySchema, {
						id,
						metric: create(MetricComponentSchema, { metrics }),
						link: create(LinkComponentSchema, { status: LinkStatus.LinkStatusConnected, via: "airthings.service", rssiDbm: dev.rssiDbm }),
					}));
					console.log(`${id}: ${metrics.length} metrics`);
				}
			} finally {
				ble.gatt.disconnect();
			}
		};

		let pollPending = false;

		const pollAll = async () => {
			while (!signal.aborted) {
				if (tracked.size > 0 && pollPending) {
					pollPending = false;
					const t0 = performance.now();
					for (const [, dev] of tracked) {
						if (signal.aborted) break;
						try { await pollDevice(dev); }
						catch (e) { console.error(`poll ${entityId(dev)}:`, e); }
					}
					pollCount++;
					lastPollMs = performance.now() - t0;
				}
				await sleep(tracked.size > 0 ? interval : 1000, signal);
			}
		};

		pollAll();

		const stream = client.watchEntities(create(ListEntitiesRequestSchema, {
			filter: create(EntityFilterSchema, {
				or: SERVICE_UUIDS.map((uuid) =>
					create(EntityFilterSchema, {
						device: create(DeviceFilterSchema, {
							ble: create(BleDeviceFilterSchema, { serviceUuids: [uuid] }),
						}),
					}),
				),
			}),
		}), { signal });

		for await (const event of stream) {
			if (!event.entity) continue;

			if (event.t === EntityChange.EntityChangeUpdated) {
				const address = event.entity.device?.ble?.address;
				const existing = tracked.get(event.entity.id);
				if (existing) {
					existing.rssiDbm = event.entity.link?.rssiDbm ?? existing.rssiDbm;
				} else if (address) {
					console.log(`discovered ${event.entity.id} at ${address}`);
					tracked.set(event.entity.id, { address, rssiDbm: event.entity.link?.rssiDbm });
					deviceCount = tracked.size;
					pollPending = true;
				}
			} else if (event.t === EntityChange.EntityChangeExpired || event.t === EntityChange.EntityChangeUnobserved) {
				if (tracked.delete(event.entity.id)) {
					console.log(`lost ${event.entity.id}`);
					deviceCount = tracked.size;
				}
			}
		}
	},

	health: () => ({
		1: { label: "devices", value: deviceCount },
		2: { label: "polls", value: pollCount },
		3: { label: "last poll ms", value: lastPollMs },
	}),
});
