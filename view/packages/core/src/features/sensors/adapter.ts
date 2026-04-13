import type { Metric } from "@projectqai/proto/metrics";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import { DeviceState } from "@projectqai/proto/world";
import { format } from "date-fns";

import type {
  CardStatus,
  ConnectionState,
  SensorKind,
  SensorReading,
  SensorWidgetData,
  SignalStrength,
} from "./types";

function getVal(m: Metric): number {
  if (m.val.case === undefined) return 0;
  if (m.val.case === "sint64" || m.val.case === "uint64") return Number(m.val.value);
  return m.val.value;
}

const DOSE_RATE_UNITS = new Set([
  MetricUnit.MetricUnitNanosievertPerHour,
  MetricUnit.MetricUnitMicrosievertPerHour,
  MetricUnit.MetricUnitMillisievertPerHour,
  MetricUnit.MetricUnitSievertPerHour,
]);

const ACCUMULATED_DOSE_UNITS = new Set([
  MetricUnit.MetricUnitNanosievert,
  MetricUnit.MetricUnitMicrosievert,
  MetricUnit.MetricUnitMillisievert,
  MetricUnit.MetricUnitSievert,
]);

function toMicrosievertPerHour(value: number, unit: MetricUnit): number {
  switch (unit) {
    case MetricUnit.MetricUnitNanosievertPerHour:
      return value / 1000;
    case MetricUnit.MetricUnitMicrosievertPerHour:
      return value;
    case MetricUnit.MetricUnitMillisievertPerHour:
      return value * 1000;
    case MetricUnit.MetricUnitSievertPerHour:
      return value * 1_000_000;
    default:
      return value;
  }
}

function toMicrosievert(value: number, unit: MetricUnit): number {
  switch (unit) {
    case MetricUnit.MetricUnitNanosievert:
      return value / 1000;
    case MetricUnit.MetricUnitMicrosievert:
      return value;
    case MetricUnit.MetricUnitMillisievert:
      return value * 1000;
    case MetricUnit.MetricUnitSievert:
      return value * 1_000_000;
    default:
      return value;
  }
}

export function getSensorKind(entity: Entity): SensorKind | null {
  const metrics = entity.metric?.metrics;
  if (!metrics?.length) return null;

  for (const m of metrics) {
    if (
      m.kind === MetricKind.MetricKindRadiationHazard ||
      m.kind === MetricKind.MetricKindChemicalHazard
    ) {
      return m.kind;
    }
  }
  return null;
}

const KIND_SHAPE: Record<SensorKind, string> = {
  [MetricKind.MetricKindRadiationHazard]: "metric",
  [MetricKind.MetricKindChemicalHazard]: "levels",
};

export function getReadingShape(entity: Entity): string | null {
  const kind = getSensorKind(entity);
  return kind ? (KIND_SHAPE[kind] ?? null) : null;
}

function extractReading(entity: Entity, kind: SensorKind): SensorReading | null {
  const metrics = entity.metric?.metrics;
  if (!metrics?.length) return null;

  if (kind === MetricKind.MetricKindRadiationHazard) {
    let doseRate: number | undefined;
    let accumulatedDose: number | undefined;

    for (const m of metrics) {
      if (m.kind !== MetricKind.MetricKindRadiationHazard) continue;
      const val = getVal(m);
      if (DOSE_RATE_UNITS.has(m.unit)) {
        doseRate = toMicrosievertPerHour(val, m.unit);
      } else if (ACCUMULATED_DOSE_UNITS.has(m.unit)) {
        accumulatedDose = toMicrosievert(val, m.unit);
      }
    }

    if (doseRate === undefined && accumulatedDose === undefined) return null;
    return {
      shape: "metric",
      primary: { value: doseRate ?? 0, unit: "µSv/h" },
      ...(accumulatedDose !== undefined && {
        secondary: { value: accumulatedDose, unit: "µSv" },
      }),
    };
  }

  if (kind === MetricKind.MetricKindChemicalHazard) {
    const levels: { code: string; value: number }[] = [];
    for (const m of metrics) {
      if (m.kind !== MetricKind.MetricKindChemicalHazard) continue;
      levels.push({
        code: m.label || `S${m.id ?? levels.length}`,
        value: getVal(m),
      });
    }
    if (levels.length === 0) return null;
    return { shape: "levels", levels, unit: "bars" };
  }

  return null;
}

function extractTimestamp(entity: Entity): string | undefined {
  const metrics = entity.metric?.metrics;
  if (!metrics?.length) return undefined;

  let latest: bigint | undefined;
  for (const m of metrics) {
    const s = m.measuredAt?.seconds;
    if (s != null && (latest == null || s > latest)) latest = s;
  }
  if (latest == null) return undefined;

  return format(new Date(Number(latest) * 1000), "HH:mm");
}

// Convention: hardware alarm = metric with kind=Count + unit=Bin (hazard threshold flag)
export function hasHardwareAlarm(entity: Entity): boolean {
  const metrics = entity.metric?.metrics;
  if (!metrics) return false;
  return metrics.some(
    (m) =>
      m.kind === MetricKind.MetricKindCount && m.unit === MetricUnit.MetricUnitBin && getVal(m) > 0,
  );
}

function deriveStatus(entity: Entity): CardStatus {
  if (!entity.device) return "disconnected";
  return "normal";
}

function deriveConnectionState(entity: Entity): ConnectionState {
  if (!entity.device) return "disconnected";
  switch (entity.device.state) {
    case DeviceState.DeviceStateActive:
      return "connected";
    case DeviceState.DeviceStatePending:
      return "reconnecting";
    case DeviceState.DeviceStateFailed:
      return "disconnected";
    default:
      return "connected";
  }
}

function deriveSignalStrength(entity: Entity): SignalStrength | undefined {
  const rssi = entity.link?.rssiDbm;
  if (rssi == null) return undefined;
  if (rssi > -60) return "high";
  if (rssi > -75) return "med";
  return "low";
}

export function entityToSensorData(entity: Entity): SensorWidgetData | null {
  const kind = getSensorKind(entity);
  if (!kind) return null;

  const reading = extractReading(entity, kind);
  const status = deriveStatus(entity);

  const connectionState = deriveConnectionState(entity);
  const signalStrength = deriveSignalStrength(entity);

  const isInitializing = connectionState !== "disconnected" && !reading;
  const timestamp = extractTimestamp(entity);

  return {
    id: entity.id,
    name: entity.label || entity.id,
    kind,
    status,
    reading,
    connectionState,
    signalStrength,
    isInitializing,
    timestamp,
  };
}
