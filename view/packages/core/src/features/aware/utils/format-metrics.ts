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
  [MetricUnit.MetricUnitNanosievert]: "nSv",
  [MetricUnit.MetricUnitNanosievertPerHour]: "nSv/h",
  [MetricUnit.MetricUnitMicrosievert]: "µSv",
  [MetricUnit.MetricUnitMicrosievertPerHour]: "µSv/h",
  [MetricUnit.MetricUnitMillisievert]: "mSv",
  [MetricUnit.MetricUnitMillisievertPerHour]: "mSv/h",
  [MetricUnit.MetricUnitSievert]: "Sv",
  [MetricUnit.MetricUnitSievertPerHour]: "Sv/h",
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

export function formatMetricValue(metric: Metric): string {
  let value = getMetricValue(metric);
  if (metric.unit === MetricUnit.MetricUnitRatio) value *= 100;

  const symbol = getUnitSymbol(metric.unit);
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
  { category: "cbrn", label: "CBRN" },
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
