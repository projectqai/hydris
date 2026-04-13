"use no memo";

import { useEffect, useRef } from "react";

import { useEntityStore } from "../aware/store/entity-store";
import { entityToSensorData, hasHardwareAlarm } from "./adapter";
import { useAlarmStore } from "./alarm-store";

const monitoredEntities = new Map<string, number>();

export function registerMonitoredEntity(entityId: string) {
  monitoredEntities.set(entityId, (monitoredEntities.get(entityId) ?? 0) + 1);
  return () => {
    const count = monitoredEntities.get(entityId) ?? 0;
    if (count <= 1) monitoredEntities.delete(entityId);
    else monitoredEntities.set(entityId, count - 1);
  };
}

// Only hardware alarms trigger the modal. Software thresholds only affect glow.
// Only monitors entities bound to a sensor widget.
export function useAlarmEffects() {
  const trigger = useAlarmStore((s) => s.trigger);
  const isCoolingDown = useAlarmStore((s) => s.isCoolingDown);
  const previousHwAlarm = useRef(new Map<string, boolean>());

  useEffect(() => {
    const unsub = useEntityStore.subscribe((state) => {
      for (const entityId of monitoredEntities.keys()) {
        const entity = state.entities.get(entityId);
        if (!entity) continue;

        const hwAlarm = hasHardwareAlarm(entity);
        const wasAlarming = previousHwAlarm.current.get(entityId) ?? false;
        previousHwAlarm.current.set(entityId, hwAlarm);

        if (!hwAlarm || wasAlarming) continue;

        const data = entityToSensorData(entity);
        if (!data || !data.reading) continue;
        if (data.isLocked) continue;

        const levelCode =
          data.reading.shape === "levels" && data.reading.levels.length
            ? data.reading.levels.reduce((a, b) => (a.value > b.value ? a : b)).code
            : undefined;

        if (!isCoolingDown(data.id, levelCode)) {
          trigger(data.id, data.name, data.kind, data.reading, levelCode);
        }
      }
    });

    return unsub;
  }, [trigger, isCoolingDown]);
}
