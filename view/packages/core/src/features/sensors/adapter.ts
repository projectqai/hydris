import type { Metric } from "@projectqai/proto/metrics";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import { LinkStatus } from "@projectqai/proto/world";
import { format } from "date-fns";

import { RAD_ACCUMULATED_IDS, RAD_DOSE_RATE_IDS } from "./metric-ids";
import type {
  CardStatus,
  ConnectionState,
  LevelValue,
  MetricValue,
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

function getRangeMax(m: Metric): number | undefined {
  const r = m.range?.max;
  if (!r || r.case === undefined) return undefined;
  return Number(r.value);
}

const DOSE_RATE_UNITS = new Set<MetricUnit>([
  MetricUnit.MetricUnitNanosievertPerHour,
  MetricUnit.MetricUnitMicrosievertPerHour,
  MetricUnit.MetricUnitMillisievertPerHour,
  MetricUnit.MetricUnitSievertPerHour,
  MetricUnit.MetricUnitNanograyPerHour,
  MetricUnit.MetricUnitMicrograyPerHour,
  MetricUnit.MetricUnitMilligrayPerHour,
  MetricUnit.MetricUnitGrayPerHour,
]);

const ACCUMULATED_DOSE_UNITS = new Set<MetricUnit>([
  MetricUnit.MetricUnitNanosievert,
  MetricUnit.MetricUnitMicrosievert,
  MetricUnit.MetricUnitMillisievert,
  MetricUnit.MetricUnitSievert,
  MetricUnit.MetricUnitNanogray,
  MetricUnit.MetricUnitMicrogray,
  MetricUnit.MetricUnitMilligray,
  MetricUnit.MetricUnitGray,
  MetricUnit.MetricUnitCentigray,
]);

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
    let doseRate: MetricValue | undefined;
    let accumulatedDose: MetricValue | undefined;

    for (const m of metrics) {
      if (m.kind !== MetricKind.MetricKindRadiationHazard) continue;
      if (m.id != null && RAD_DOSE_RATE_IDS.has(m.id) && DOSE_RATE_UNITS.has(m.unit)) {
        doseRate = { value: getVal(m), unit: m.unit };
      } else if (
        m.id != null &&
        RAD_ACCUMULATED_IDS.has(m.id) &&
        ACCUMULATED_DOSE_UNITS.has(m.unit)
      ) {
        accumulatedDose = { value: getVal(m), unit: m.unit };
      }
    }

    if (!doseRate) return null;
    return {
      shape: "metric",
      primary: doseRate,
      ...(accumulatedDose && { secondary: accumulatedDose }),
    };
  }

  if (kind === MetricKind.MetricKindChemicalHazard) {
    const levels: LevelValue[] = [];
    for (const m of metrics) {
      if (m.kind !== MetricKind.MetricKindChemicalHazard) continue;
      levels.push({
        code: m.label || `S${m.id ?? levels.length}`,
        value: getVal(m),
        max: getRangeMax(m),
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

function deriveStatus(connectionState: ConnectionState, inCooldown: boolean): CardStatus {
  if (connectionState === "disconnected") return "disconnected";
  if (inCooldown) return "cooldown";
  return "normal";
}

function deriveConnectionState(entity: Entity): ConnectionState {
  if (!entity.link) return "disconnected";
  switch (entity.link.status) {
    case LinkStatus.LinkStatusConnected:
      return "connected";
    case LinkStatus.LinkStatusDegraded:
      return "reconnecting";
    case LinkStatus.LinkStatusLost:
      return "disconnected";
    default:
      return "disconnected";
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
  const connectionState = deriveConnectionState(entity);
  const signalStrength = deriveSignalStrength(entity);

  const isInitializing = connectionState !== "disconnected" && !reading;
  const timestamp = extractTimestamp(entity);

  const cfgValue = entity.configurable?.value;
  const isLocked = cfgValue?.locked === true;
  const isSilent = cfgValue?.silent === true;
  const status = deriveStatus(connectionState, cfgValue?.cooldown === true);

  return {
    id: entity.id,
    name: entity.label || entity.id,
    kind,
    status,
    reading,
    connectionState,
    signalStrength,
    isLocked,
    isSilent,
    isInitializing,
    timestamp,
  };
}
