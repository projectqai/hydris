import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";

export type SensorKind = MetricKind.MetricKindRadiationHazard | MetricKind.MetricKindChemicalHazard;

export type MetricValue = { value: number; unit: MetricUnit };
export type LevelValue = { code: string; value: number; max?: number };

type MetricReading = { shape: "metric"; primary: MetricValue; secondary?: MetricValue };
export type LevelsReading = { shape: "levels"; levels: LevelValue[]; unit: string };
export type SensorReading = MetricReading | LevelsReading;

export type CardStatus = "normal" | "alarm" | "cooldown" | "disconnected";

export type ConnectionState = "connected" | "reconnecting" | "disconnected";
export type SignalStrength = "high" | "med" | "low";

export type SensorWidgetData = {
  id: string;
  name: string;
  kind: SensorKind;
  status: CardStatus;
  reading: SensorReading | null;
  connectionState: ConnectionState;
  signalStrength?: SignalStrength;
  isLocked?: boolean;
  isSilent?: boolean;
  isInitializing?: boolean;
  hasSensorError?: boolean;
  measuredAt?: { seconds: bigint };
};

export type ThresholdConfig =
  | { type: "fixed"; value: number; unit: MetricUnit | string }
  | { type: "none" };

export const SENSOR_KIND_LABEL: Record<SensorKind, string> = {
  [MetricKind.MetricKindRadiationHazard]: "Radiation",
  [MetricKind.MetricKindChemicalHazard]: "Chemical",
};

export const SENSOR_THRESHOLDS: Record<SensorKind, ThresholdConfig> = {
  [MetricKind.MetricKindRadiationHazard]: {
    type: "fixed",
    value: 2.5,
    unit: MetricUnit.MetricUnitMicrosievertPerHour,
  },
  [MetricKind.MetricKindChemicalHazard]: { type: "fixed", value: 1, unit: "bars" },
};
