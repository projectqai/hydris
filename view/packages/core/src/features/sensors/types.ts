import { MetricKind } from "@projectqai/proto/metrics";

export type SensorKind = MetricKind.MetricKindRadiationHazard | MetricKind.MetricKindChemicalHazard;

export type MetricValue = { value: number; unit: string };
export type LevelValue = { code: string; value: number };

export type MetricReading = { shape: "metric"; primary: MetricValue; secondary?: MetricValue };
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
  isInitializing?: boolean;
  timestamp?: string;
};

export type ThresholdConfig = { type: "fixed"; value: number; unit: string } | { type: "none" };

export const SENSOR_KIND_LABEL: Record<SensorKind, string> = {
  [MetricKind.MetricKindRadiationHazard]: "Radiation",
  [MetricKind.MetricKindChemicalHazard]: "Chemical",
};

export const SENSOR_THRESHOLDS: Record<SensorKind, ThresholdConfig> = {
  [MetricKind.MetricKindRadiationHazard]: { type: "fixed", value: 2.5, unit: "µSv/h" },
  [MetricKind.MetricKindChemicalHazard]: { type: "fixed", value: 1, unit: "bars" },
};
