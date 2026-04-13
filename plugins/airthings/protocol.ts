// Airthings BLE protocol constants, model definitions, and GATT parsers.
// Reference: https://github.com/Airthings/airthings-ble

// -- Service UUIDs (used for BLE discovery filtering) --

export const SERVICE_UUIDS = [
	"b42e1f6e-ade7-11e4-89d3-123b93f75cba", // Wave Gen 1
	"b42e4a8e-ade7-11e4-89d3-123b93f75cba", // Wave 2 / Wave Radon
	"b42e1c08-ade7-11e4-89d3-123b93f75cba", // Wave Plus
	"b42e3882-ade7-11e4-89d3-123b93f75cba", // Wave Mini
	"b42e90a2-ade7-11e4-89d3-123b93f75cba", // Atom (Wave Enhance, Corentium Home 2)
];

// -- Characteristic UUIDs --

export const CHAR_MODEL_NUMBER = "00002a24-0000-1000-8000-00805f9b34fb";

const CHAR_WAVE_PLUS = "b42e2a68-ade7-11e4-89d3-123b93f75cba";
const CHAR_WAVE2     = "b42e4dcc-ade7-11e4-89d3-123b93f75cba";
const CHAR_WAVE_MINI = "b42e3b98-ade7-11e4-89d3-123b93f75cba";

// Wave Gen 1 individual characteristics
const CHAR_TEMPERATURE = "00002a6e-0000-1000-8000-00805f9b34fb";
const CHAR_HUMIDITY    = "00002a6f-0000-1000-8000-00805f9b34fb";
const CHAR_RADON_1DAY  = "b42e01aa-ade7-11e4-89d3-123b93f75cba";
const CHAR_RADON_LONG  = "b42e0a4c-ade7-11e4-89d3-123b93f75cba";

// -- Validity bounds --

const MAX_RADON   = 16383;
const MAX_CO2_VOC = 65534;

// -- Types --

export type DeviceModel = "2900" | "2920" | "2930" | "2950" | "3210" | "3220" | "3250";

export const MODEL_NAMES: Record<string, string> = {
	"2900": "Wave Gen 1",
	"2920": "Wave Mini",
	"2930": "Wave Plus",
	"2950": "Wave Radon",
	"3210": "Wave Enhance EU",
	"3220": "Wave Enhance US",
	"3250": "Corentium Home 2",
};

export interface SensorReadings {
	temperature?: number;
	humidity?: number;
	pressure?: number;   // mbar
	co2?: number;        // ppm
	voc?: number;        // ppb
	radon1day?: number;  // Bq/m³
	radonLongterm?: number;
	illuminance?: number; // raw 0-255
}

// -- Service UUID lookup --

const MODEL_SERVICE: Record<string, string> = {
	"2900": "b42e1f6e-ade7-11e4-89d3-123b93f75cba",
	"2920": "b42e3882-ade7-11e4-89d3-123b93f75cba",
	"2930": "b42e1c08-ade7-11e4-89d3-123b93f75cba",
	"2950": "b42e4a8e-ade7-11e4-89d3-123b93f75cba",
	"3210": "b42e90a2-ade7-11e4-89d3-123b93f75cba",
	"3220": "b42e90a2-ade7-11e4-89d3-123b93f75cba",
	"3250": "b42e90a2-ade7-11e4-89d3-123b93f75cba",
};

// -- Parsers --

// Wave Plus format: <4B8H (4 uint8 + 8 uint16, little-endian)
// Byte offsets: [B@0][B@1][B@2][B@3][H@4][H@6][H@8][H@10][H@12][H@14][H@16][H@18]
function parseWavePlus(buf: ArrayBuffer): SensorReadings {
	const v = new DataView(buf);
	const r: SensorReadings = {};

	const humRaw = v.getUint8(1);
	if (humRaw > 0) r.humidity = humRaw / 2.0;

	r.illuminance = v.getUint8(2);

	const radon1 = v.getUint16(4, true);
	if (radon1 > 0 && radon1 <= MAX_RADON) r.radon1day = radon1;

	const radonL = v.getUint16(6, true);
	if (radonL > 0 && radonL <= MAX_RADON) r.radonLongterm = radonL;

	const tempRaw = v.getUint16(8, true);
	if (tempRaw > 0) r.temperature = tempRaw / 100.0;

	const presRaw = v.getUint16(10, true);
	if (presRaw > 0) r.pressure = presRaw / 50.0;

	const co2 = v.getUint16(12, true);
	if (co2 > 0 && co2 < MAX_CO2_VOC) r.co2 = co2;

	const voc = v.getUint16(14, true);
	if (voc > 0 && voc < MAX_CO2_VOC) r.voc = voc;

	return r;
}

// Wave 2 / Wave Radon format: <4B8H (same layout, fewer fields used)
function parseWave2(buf: ArrayBuffer): SensorReadings {
	const v = new DataView(buf);
	const r: SensorReadings = {};

	const humRaw = v.getUint8(1);
	if (humRaw > 0) r.humidity = humRaw / 2.0;

	r.illuminance = v.getUint8(2);

	const radon1 = v.getUint16(4, true);
	if (radon1 > 0 && radon1 <= MAX_RADON) r.radon1day = radon1;

	const radonL = v.getUint16(6, true);
	if (radonL > 0 && radonL <= MAX_RADON) r.radonLongterm = radonL;

	const tempRaw = v.getUint16(8, true);
	if (tempRaw > 0) r.temperature = tempRaw / 100.0;

	return r;
}

// Wave Mini format: <2B5HLL
// [B@0][B@1][H@2][H@4][H@6][H@8][H@10][L@12][L@16]
function parseWaveMini(buf: ArrayBuffer): SensorReadings {
	const v = new DataView(buf);
	const r: SensorReadings = {};

	r.illuminance = v.getUint8(0);

	const tempRaw = v.getUint16(2, true);
	if (tempRaw > 0) r.temperature = tempRaw / 100.0 - 273.15;

	const presRaw = v.getUint16(4, true);
	if (presRaw > 0) r.pressure = presRaw / 50.0;

	const humRaw = v.getUint16(6, true);
	if (humRaw > 0) r.humidity = humRaw / 100.0;

	const voc = v.getUint16(8, true);
	if (voc > 0 && voc < MAX_CO2_VOC) r.voc = voc;

	return r;
}

// Wave Gen 1: individual characteristic reads
async function readWaveGen1(service: BluetoothRemoteGATTService): Promise<SensorReadings> {
	const r: SensorReadings = {};

	try {
		const buf = await (await service.getCharacteristic(CHAR_TEMPERATURE)).readValue();
		r.temperature = new DataView(buf).getInt16(0, true) / 100.0;
	} catch { /* may not exist */ }

	try {
		const buf = await (await service.getCharacteristic(CHAR_HUMIDITY)).readValue();
		r.humidity = new DataView(buf).getUint16(0, true) / 100.0;
	} catch { /* */ }

	try {
		const buf = await (await service.getCharacteristic(CHAR_RADON_1DAY)).readValue();
		const val = new DataView(buf).getUint16(0, true);
		if (val > 0 && val <= MAX_RADON) r.radon1day = val;
	} catch { /* */ }

	try {
		const buf = await (await service.getCharacteristic(CHAR_RADON_LONG)).readValue();
		const val = new DataView(buf).getUint16(0, true);
		if (val > 0 && val <= MAX_RADON) r.radonLongterm = val;
	} catch { /* */ }

	return r;
}

// -- Public API --

export async function readSensors(server: BluetoothRemoteGATTServer, model: DeviceModel): Promise<SensorReadings> {
	const svcUUID = MODEL_SERVICE[model];
	if (!svcUUID) return {};

	const service = await server.getPrimaryService(svcUUID);

	switch (model) {
		case "2930": return parseWavePlus(await (await service.getCharacteristic(CHAR_WAVE_PLUS)).readValue());
		case "2950": return parseWave2(await (await service.getCharacteristic(CHAR_WAVE2)).readValue());
		case "2920": return parseWaveMini(await (await service.getCharacteristic(CHAR_WAVE_MINI)).readValue());
		case "2900": return readWaveGen1(service);
		case "3210":
		case "3220":
		case "3250":
			console.warn(`Atom device model ${model} not yet supported (CBOR protocol)`);
			return {};
	}
}
