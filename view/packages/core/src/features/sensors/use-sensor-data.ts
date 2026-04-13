import { useSyncExternalStore } from "react";

import { useEntityStore } from "../aware/store/entity-store";
import { entityToSensorData } from "./adapter";
import { useAlarmStore } from "./alarm-store";
import type { CardStatus, SensorWidgetData } from "./types";

function useAlarmStatus(entityId: string | undefined): CardStatus | null {
  // Snapshot must be pure — expiry timer cleans up the map so we just check existence
  const alarmState = useSyncExternalStore(useAlarmStore.subscribe, () => {
    if (!entityId) return null;
    const s = useAlarmStore.getState();
    if (s.activeAlarms.has(entityId)) return "alarm" as const;

    for (const key of s.cooldowns.keys()) {
      if (key === entityId || key.startsWith(`${entityId}:`)) {
        return "cooldown" as const;
      }
    }
    return null;
  });

  return alarmState;
}

export function useSensorData(entityId: string): SensorWidgetData | null {
  const entity = useEntityStore((state) => state.entities.get(entityId));
  const data = entity ? entityToSensorData(entity) : null;
  const alarmStatus = useAlarmStatus(entityId);

  if (!data) return null;
  if (alarmStatus) return { ...data, status: alarmStatus };
  return data;
}
