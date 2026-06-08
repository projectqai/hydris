import { useSyncExternalStore } from "react";

import { useEntityStore } from "../aware/store/entity-store";
import { entityToSensorData } from "./adapter";
import { useAlarmStore } from "./alarm-store";
import type { SensorWidgetData } from "./types";

function useAlarmStatus(entityId: string | undefined): "alarm" | null {
  return useSyncExternalStore(useAlarmStore.subscribe, () => {
    if (!entityId) return null;
    return useAlarmStore.getState().activeAlarms.has(entityId) ? "alarm" : null;
  });
}

export function useSensorData(entityId: string): SensorWidgetData | null {
  const entity = useEntityStore((state) => state.entities.get(entityId));
  const data = entity ? entityToSensorData(entity) : null;
  const alarmStatus = useAlarmStatus(entityId);

  if (!data) return null;
  if (alarmStatus) return { ...data, status: alarmStatus };
  return data;
}
