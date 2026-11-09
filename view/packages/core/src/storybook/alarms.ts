import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";

import type { AlarmState } from "../features/sensors/alarm-store";
import type { SensorReading } from "../features/sensors/types";
import { STORY_NOW } from "./clock";

export const DOSE_RATE: SensorReading = {
  shape: "metric",
  primary: { value: 4.2, unit: MetricUnit.MetricUnitMicrosievertPerHour },
};

export function alarm(sensorId: string, reading: SensorReading, levelCode?: string): AlarmState {
  return {
    sensorId,
    sensorName: `${sensorId} sensor`,
    sensorKind:
      reading.shape === "levels"
        ? MetricKind.MetricKindChemicalHazard
        : MetricKind.MetricKindRadiationHazard,
    reading,
    triggeredAt: STORY_NOW - 30_000,
    levelCode,
  };
}
