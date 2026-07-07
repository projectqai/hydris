import type { Metric } from "@projectqai/proto/metrics";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { formatDistanceToNowStrict } from "date-fns";

const UNIT_SYMBOLS: Partial<Record<MetricUnit, string>> = {
  [MetricUnit.MetricUnitUnspecified]: "",
  [MetricUnit.MetricUnitCelsius]: "°C",
  [MetricUnit.MetricUnitFahrenheit]: "°F",
  [MetricUnit.MetricUnitKelvin]: "K",
  [MetricUnit.MetricUnitHectopascal]: "hPa",
  [MetricUnit.MetricUnitPsi]: "psi",
  [MetricUnit.MetricUnitBar]: "bar",
  [MetricUnit.MetricUnitMillibar]: "mbar",
  [MetricUnit.MetricUnitInHg]: "inHg",
  [MetricUnit.MetricUnitPercent]: "%",
  [MetricUnit.MetricUnitRatio]: "%",
  [MetricUnit.MetricUnitVolt]: "V",
  [MetricUnit.MetricUnitMillivolt]: "mV",
  [MetricUnit.MetricUnitAmpere]: "A",
  [MetricUnit.MetricUnitMilliampere]: "mA",
  [MetricUnit.MetricUnitWatt]: "W",
  [MetricUnit.MetricUnitKilowatt]: "kW",
  [MetricUnit.MetricUnitWattHour]: "Wh",
  [MetricUnit.MetricUnitKilowattHour]: "kWh",
  [MetricUnit.MetricUnitHertz]: "Hz",
  [MetricUnit.MetricUnitKilohertz]: "kHz",
  [MetricUnit.MetricUnitMegahertz]: "MHz",
  [MetricUnit.MetricUnitOhm]: "Ω",
  [MetricUnit.MetricUnitMeter]: "m",
  [MetricUnit.MetricUnitKilometer]: "km",
  [MetricUnit.MetricUnitFoot]: "ft",
  [MetricUnit.MetricUnitNauticalMile]: "NM",
  [MetricUnit.MetricUnitMeterPerSecond]: "m/s",
  [MetricUnit.MetricUnitKnot]: "kn",
  [MetricUnit.MetricUnitKilometerPerHour]: "km/h",
  [MetricUnit.MetricUnitMeterPerSecondSquared]: "m/s²",
  [MetricUnit.MetricUnitLux]: "lx",
  [MetricUnit.MetricUnitDecibel]: "dB",
  [MetricUnit.MetricUnitDecibelA]: "dBA",
  [MetricUnit.MetricUnitBitPerSecond]: "bps",
  [MetricUnit.MetricUnitKilobitPerSecond]: "kbps",
  [MetricUnit.MetricUnitMegabitPerSecond]: "Mbps",
  [MetricUnit.MetricUnitMillisecond]: "ms",
  [MetricUnit.MetricUnitByte]: "B",
  [MetricUnit.MetricUnitKilobyte]: "KB",
  [MetricUnit.MetricUnitMegabyte]: "MB",
  [MetricUnit.MetricUnitGigabyte]: "GB",
  [MetricUnit.MetricUnitPartsPerMillion]: "ppm",
  [MetricUnit.MetricUnitMicrogramPerCubicMeter]: "µg/m³",
  [MetricUnit.MetricUnitMillimeter]: "mm",
  [MetricUnit.MetricUnitMillimeterPerHour]: "mm/h",
  [MetricUnit.MetricUnitDegree]: "°",
  [MetricUnit.MetricUnitRadian]: "rad",
  [MetricUnit.MetricUnitSecond]: "s",
  [MetricUnit.MetricUnitMinute]: "min",
  [MetricUnit.MetricUnitHour]: "h",
  [MetricUnit.MetricUnitKilogram]: "kg",
  [MetricUnit.MetricUnitGram]: "g",
  [MetricUnit.MetricUnitPound]: "lb",
  [MetricUnit.MetricUnitLiter]: "L",
  [MetricUnit.MetricUnitMilliliter]: "mL",
  [MetricUnit.MetricUnitCubicMeter]: "m³",
  [MetricUnit.MetricUnitGallon]: "gal",
  [MetricUnit.MetricUnitCount]: "",
  [MetricUnit.MetricUnitLiterPerMinute]: "L/min",
  [MetricUnit.MetricUnitCubicMeterPerHour]: "m³/h",
  [MetricUnit.MetricUnitDecibelMilliwatt]: "dBm",
  [MetricUnit.MetricUnitWattPerSquareMeter]: "W/m²",
  [MetricUnit.MetricUnitBeatsPerMinute]: "bpm",
  [MetricUnit.MetricUnitNanosievert]: "nSv",
  [MetricUnit.MetricUnitNanosievertPerHour]: "nSv/h",
  [MetricUnit.MetricUnitMicrosievert]: "µSv",
  [MetricUnit.MetricUnitMicrosievertPerHour]: "µSv/h",
  [MetricUnit.MetricUnitMillisievert]: "mSv",
  [MetricUnit.MetricUnitMillisievertPerHour]: "mSv/h",
  [MetricUnit.MetricUnitSievert]: "Sv",
  [MetricUnit.MetricUnitSievertPerHour]: "Sv/h",
  [MetricUnit.MetricUnitNanogray]: "nGy",
  [MetricUnit.MetricUnitNanograyPerHour]: "nGy/h",
  [MetricUnit.MetricUnitMicrogray]: "µGy",
  [MetricUnit.MetricUnitMicrograyPerHour]: "µGy/h",
  [MetricUnit.MetricUnitMilligray]: "mGy",
  [MetricUnit.MetricUnitMilligrayPerHour]: "mGy/h",
  [MetricUnit.MetricUnitGray]: "Gy",
  [MetricUnit.MetricUnitGrayPerHour]: "Gy/h",
  [MetricUnit.MetricUnitCentigray]: "cGy",
  [MetricUnit.MetricUnitCountsPerSecond]: "cps",
  [MetricUnit.MetricUnitPartsPerBillion]: "ppb",
  [MetricUnit.MetricUnitMilligramPerCubicMeter]: "mg/m³",
  [MetricUnit.MetricUnitMicrogramPerSquareMeter]: "µg/m²",
  [MetricUnit.MetricUnitBin]: "",
};

const KIND_LABELS: Partial<Record<MetricKind, string>> = {
  [MetricKind.MetricKindTemperature]: "Temperature",
  [MetricKind.MetricKindPressure]: "Pressure",
  [MetricKind.MetricKindHumidity]: "Humidity",
  [MetricKind.MetricKindIlluminance]: "Illuminance",
  [MetricKind.MetricKindSoundLevel]: "Sound level",
  [MetricKind.MetricKindWindSpeed]: "Wind speed",
  [MetricKind.MetricKindWindDirection]: "Wind direction",
  [MetricKind.MetricKindPrecipitation]: "Precipitation",
  [MetricKind.MetricKindIrradiance]: "Irradiance",
  [MetricKind.MetricKindVoltage]: "Voltage",
  [MetricKind.MetricKindCurrent]: "Current",
  [MetricKind.MetricKindPower]: "Power",
  [MetricKind.MetricKindEnergy]: "Energy",
  [MetricKind.MetricKindFrequency]: "Frequency",
  [MetricKind.MetricKindResistance]: "Resistance",
  [MetricKind.MetricKindProgress]: "Progress",
  [MetricKind.MetricKindPercentage]: "Percentage",
  [MetricKind.MetricKindDistance]: "Distance",
  [MetricKind.MetricKindSpeed]: "Speed",
  [MetricKind.MetricKindAcceleration]: "Acceleration",
  [MetricKind.MetricKindDepth]: "Depth",
  [MetricKind.MetricKindDataRate]: "Data rate",
  [MetricKind.MetricKindLatency]: "Latency",
  [MetricKind.MetricKindDataSize]: "Data size",
  [MetricKind.MetricKindCo2]: "CO₂",
  [MetricKind.MetricKindPm25]: "PM2.5",
  [MetricKind.MetricKindPm10]: "PM10",
  [MetricKind.MetricKindAqi]: "AQI",
  [MetricKind.MetricKindPh]: "pH",
  [MetricKind.MetricKindWeight]: "Weight",
  [MetricKind.MetricKindVolume]: "Volume",
  [MetricKind.MetricKindVolumeFlowRate]: "Flow rate",
  [MetricKind.MetricKindSignalStrength]: "Signal",
  [MetricKind.MetricKindDuration]: "Duration",
  [MetricKind.MetricKindCount]: "Count",
  [MetricKind.MetricKindRadiationHazard]: "Radiation",
  [MetricKind.MetricKindChemicalHazard]: "Chemical",
  [MetricKind.MetricKindBiologicalHazard]: "Biological",
  [MetricKind.MetricKindNuclearHazard]: "Nuclear",
  [MetricKind.MetricKindHeartRate]: "Heart Rate",
  [MetricKind.MetricKindOxygenSaturation]: "SpO₂",
  [MetricKind.MetricKindBodyTemperature]: "Body Temp",
  [MetricKind.MetricKindHealth]: "Health",
  [MetricKind.MetricKindAmmo]: "Ammo",
  [MetricKind.MetricKindFuel]: "Fuel",
};

export function getMetricValue(metric: Metric): number {
  const { val } = metric;
  if (val.case === undefined) return 0;
  if (val.case === "sint64" || val.case === "uint64") return Number(val.value);
  return val.value;
}

export function getUnitSymbol(unit: MetricUnit): string {
  return UNIT_SYMBOLS[unit] ?? "";
}

type UnitFamily = "sv-rate" | "sv-dose" | "gy-rate" | "gy-dose";

type UnitTier = { unit: MetricUnit; nanoScale: number; display?: false };

// Tiers within each family are ordered largest to smallest.
// nanoScale is how many of the family's nano-base unit fit into one of this unit
// (so 1 mSv = 1_000_000 nSv). Multiply a value by its nanoScale to get the
// value expressed in the family's nano base.
const FAMILY_TIERS: Record<UnitFamily, UnitTier[]> = {
  "sv-rate": [
    { unit: MetricUnit.MetricUnitSievertPerHour, nanoScale: 1_000_000_000 },
    { unit: MetricUnit.MetricUnitMillisievertPerHour, nanoScale: 1_000_000 },
    { unit: MetricUnit.MetricUnitMicrosievertPerHour, nanoScale: 1_000 },
    { unit: MetricUnit.MetricUnitNanosievertPerHour, nanoScale: 1 },
  ],
  "sv-dose": [
    { unit: MetricUnit.MetricUnitSievert, nanoScale: 1_000_000_000 },
    { unit: MetricUnit.MetricUnitMillisievert, nanoScale: 1_000_000 },
    { unit: MetricUnit.MetricUnitMicrosievert, nanoScale: 1_000 },
    { unit: MetricUnit.MetricUnitNanosievert, nanoScale: 1 },
  ],
  "gy-rate": [
    { unit: MetricUnit.MetricUnitGrayPerHour, nanoScale: 1_000_000_000 },
    { unit: MetricUnit.MetricUnitMilligrayPerHour, nanoScale: 1_000_000 },
    { unit: MetricUnit.MetricUnitMicrograyPerHour, nanoScale: 1_000 },
    { unit: MetricUnit.MetricUnitNanograyPerHour, nanoScale: 1 },
  ],
  "gy-dose": [
    { unit: MetricUnit.MetricUnitGray, nanoScale: 1_000_000_000 },
    // 1 cGy is 10 mGy, which is 10_000_000 nGy. Kept so native cGy readings
    // convert, but not an auto-scale target so dose scales like the Sv families.
    { unit: MetricUnit.MetricUnitCentigray, nanoScale: 10_000_000, display: false },
    { unit: MetricUnit.MetricUnitMilligray, nanoScale: 1_000_000 },
    { unit: MetricUnit.MetricUnitMicrogray, nanoScale: 1_000 },
    { unit: MetricUnit.MetricUnitNanogray, nanoScale: 1 },
  ],
};

const UNIT_TO_FAMILY = new Map<MetricUnit, { family: UnitFamily; nanoScale: number }>();
for (const [family, tiers] of Object.entries(FAMILY_TIERS) as [UnitFamily, UnitTier[]][]) {
  for (const tier of tiers) UNIT_TO_FAMILY.set(tier.unit, { family, nanoScale: tier.nanoScale });
}

// Smallest unit each family scales down to. Every radiation family floors at
// micro and never shows nano, so 80 nSv/h reads as 0.08 µSv/h and 80 nGy/h as
// 0.08 µGy/h.
const DISPLAY_FLOOR: Partial<Record<UnitFamily, MetricUnit>> = {
  "sv-rate": MetricUnit.MetricUnitMicrosievertPerHour,
  "sv-dose": MetricUnit.MetricUnitMicrosievert,
  "gy-rate": MetricUnit.MetricUnitMicrograyPerHour,
  "gy-dose": MetricUnit.MetricUnitMicrogray,
};

// Convert a value between two units. Returns null when the units belong to
// different families (e.g. Sieverts vs Grays) since that ratio depends on
// radiation type and is not a pure unit conversion.
export function convertUnit(
  value: number,
  fromUnit: MetricUnit,
  toUnit: MetricUnit,
): number | null {
  if (fromUnit === toUnit) return value;
  const fromInfo = UNIT_TO_FAMILY.get(fromUnit);
  const toInfo = UNIT_TO_FAMILY.get(toUnit);
  if (!fromInfo || !toInfo || fromInfo.family !== toInfo.family) return null;
  return (value * fromInfo.nanoScale) / toInfo.nanoScale;
}

// Pick the largest tier in the value's own family where the magnitude is still
// at least 1 (so 1500 µSv/h becomes 1.5 mSv/h). A family with a display floor
// never scales below it, so 80 nSv/h reads as 0.08 µSv/h rather than 80 nSv/h.
// Units outside a known family pass through unchanged.
export function autoScaleUnit(
  value: number,
  unit: MetricUnit,
): { value: number; unit: MetricUnit } {
  const info = UNIT_TO_FAMILY.get(unit);
  if (!info) return { value, unit };
  const valueInNanoBase = value * info.nanoScale;
  const tiers = FAMILY_TIERS[info.family];
  const floor = DISPLAY_FLOOR[info.family];
  const floorScale = floor ? UNIT_TO_FAMILY.get(floor)!.nanoScale : 0;
  for (const tier of tiers) {
    if (tier.display === false) continue;
    if (tier.nanoScale < floorScale) break;
    if (Math.abs(valueInNanoBase) >= tier.nanoScale) {
      return { value: valueInNanoBase / tier.nanoScale, unit: tier.unit };
    }
  }
  const smallestTier = tiers.find((t) => t.nanoScale === floorScale) ?? tiers[tiers.length - 1]!;
  return { value: valueInNanoBase / smallestTier.nanoScale, unit: smallestTier.unit };
}

// True for families with a display floor, whose values are shown with two
// decimals so the floored magnitude stays legible (0.08 µSv/h, not 0.1).
export function hasDisplayFloor(unit: MetricUnit): boolean {
  const info = UNIT_TO_FAMILY.get(unit);
  return info != null && info.family in DISPLAY_FLOOR;
}

// Prepare a raw metric value for display: ratios become percentages, everything
// else auto-scales to its family's display unit. The shared entry point every
// value formatter uses so they stay in step.
export function scaleForDisplay(
  value: number,
  unit: MetricUnit,
): { value: number; unit: MetricUnit } {
  if (unit === MetricUnit.MetricUnitRatio) return { value: value * 100, unit };
  return autoScaleUnit(value, unit);
}

export function formatMetricValue(metric: Metric): string {
  const { value, unit } = scaleForDisplay(getMetricValue(metric), metric.unit);

  const symbol = getUnitSymbol(unit);
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function getMetricLabel(metric: Metric): string {
  if (metric.label) return metric.label;
  if (metric.kind != null) return KIND_LABELS[metric.kind] ?? "Metric";
  return "Metric";
}

export function formatRelativeTime(timestamp: { seconds: bigint }): string {
  const date = new Date(Number(timestamp.seconds) * 1000);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 1000) return "just now";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function formatCompactRelativeTime(timestamp: { seconds: bigint }): string {
  const diffS = Math.max(0, Math.floor(Date.now() / 1000 - Number(timestamp.seconds)));
  if (diffS < 10) return "now";
  if (diffS < 60) return `${diffS}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

export function getSharedTimestamp(
  metrics: readonly Metric[],
  { strict = true }: { strict?: boolean } = {},
): { seconds: bigint } | null {
  if (metrics.length === 0) return null;
  let shared: { seconds: bigint } | null = null;
  for (const m of metrics) {
    if (!m.measuredAt) {
      if (strict) return null;
      continue;
    }
    if (!shared) {
      shared = m.measuredAt;
    } else if (m.measuredAt.seconds !== shared.seconds) {
      return null;
    }
  }
  return shared;
}

export type MetricVisual = "gauge" | "value";
export type MetricCategory =
  | "environmental"
  | "electrical"
  | "spatial"
  | "network"
  | "airQuality"
  | "cbrn"
  | "vital"
  | "equipment"
  | "general";

const GAUGE_KINDS = new Set([
  MetricKind.MetricKindProgress,
  MetricKind.MetricKindPercentage,
  MetricKind.MetricKindHumidity,
]);

export function getMetricVisual(metric: Metric): MetricVisual {
  if (metric.kind != null && GAUGE_KINDS.has(metric.kind)) return "gauge";
  return "value";
}

const KIND_CATEGORY: Partial<Record<MetricKind, MetricCategory>> = {
  [MetricKind.MetricKindTemperature]: "environmental",
  [MetricKind.MetricKindPressure]: "environmental",
  [MetricKind.MetricKindHumidity]: "environmental",
  [MetricKind.MetricKindIlluminance]: "environmental",
  [MetricKind.MetricKindSoundLevel]: "environmental",
  [MetricKind.MetricKindWindSpeed]: "environmental",
  [MetricKind.MetricKindWindDirection]: "environmental",
  [MetricKind.MetricKindPrecipitation]: "environmental",
  [MetricKind.MetricKindIrradiance]: "environmental",
  [MetricKind.MetricKindVoltage]: "electrical",
  [MetricKind.MetricKindCurrent]: "electrical",
  [MetricKind.MetricKindPower]: "electrical",
  [MetricKind.MetricKindEnergy]: "electrical",
  [MetricKind.MetricKindFrequency]: "electrical",
  [MetricKind.MetricKindResistance]: "electrical",
  [MetricKind.MetricKindDistance]: "spatial",
  [MetricKind.MetricKindSpeed]: "spatial",
  [MetricKind.MetricKindAcceleration]: "spatial",
  [MetricKind.MetricKindDepth]: "spatial",
  [MetricKind.MetricKindDataRate]: "network",
  [MetricKind.MetricKindLatency]: "network",
  [MetricKind.MetricKindDataSize]: "network",
  [MetricKind.MetricKindSignalStrength]: "network",
  [MetricKind.MetricKindCo2]: "airQuality",
  [MetricKind.MetricKindPm25]: "airQuality",
  [MetricKind.MetricKindPm10]: "airQuality",
  [MetricKind.MetricKindAqi]: "airQuality",
  [MetricKind.MetricKindPh]: "airQuality",
  [MetricKind.MetricKindRadiationHazard]: "cbrn",
  [MetricKind.MetricKindChemicalHazard]: "cbrn",
  [MetricKind.MetricKindBiologicalHazard]: "cbrn",
  [MetricKind.MetricKindNuclearHazard]: "cbrn",
  [MetricKind.MetricKindHeartRate]: "vital",
  [MetricKind.MetricKindOxygenSaturation]: "vital",
  [MetricKind.MetricKindBodyTemperature]: "vital",
  [MetricKind.MetricKindHealth]: "equipment",
  [MetricKind.MetricKindAmmo]: "equipment",
  [MetricKind.MetricKindFuel]: "equipment",
};

export function getMetricCategory(metric: Metric): MetricCategory {
  if (metric.kind != null) return KIND_CATEGORY[metric.kind] ?? "general";
  return "general";
}

const CATEGORY_ORDER: { category: MetricCategory; label: string }[] = [
  { category: "environmental", label: "Environmental" },
  { category: "electrical", label: "Electrical" },
  { category: "spatial", label: "Spatial" },
  { category: "network", label: "Network" },
  { category: "airQuality", label: "Air Quality" },
  { category: "cbrn", label: "Hazards" },
  { category: "vital", label: "Vitals" },
  { category: "equipment", label: "Equipment" },
  { category: "general", label: "General" },
];

export function groupMetricsByCategory(metrics: readonly Metric[]) {
  const grouped = new Map<MetricCategory, Metric[]>();
  for (const m of metrics) {
    const cat = getMetricCategory(m);
    const arr = grouped.get(cat);
    if (arr) arr.push(m);
    else grouped.set(cat, [m]);
  }
  return CATEGORY_ORDER.filter((c) => grouped.has(c.category)).map((c) => ({
    ...c,
    metrics: grouped.get(c.category)!,
  }));
}
