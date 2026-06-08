import { create } from "zustand";

import type { SensorKind, SensorReading } from "./types";

export type AlarmState = {
  sensorId: string;
  sensorName: string;
  sensorKind: SensorKind;
  reading: SensorReading;
  triggeredAt: number;
  levelCode?: string;
};

type AlarmStore = {
  activeAlarms: Map<string, AlarmState>;
  silenced: Set<string>;

  trigger: (
    sensorId: string,
    sensorName: string,
    sensorKind: SensorKind,
    reading: SensorReading,
    levelCode?: string,
  ) => boolean;
  acknowledge: (sensorId: string) => void;
  toggleSilent: (sensorId: string) => void;
  isSilent: (sensorId: string) => boolean;
  getTopAlarm: () => AlarmState | null;
};

export const useAlarmStore = create<AlarmStore>((set, get) => ({
  activeAlarms: new Map(),
  silenced: new Set(),

  trigger(sensorId, sensorName, sensorKind, reading, levelCode) {
    const state = get();

    if (state.silenced.has(sensorId)) return false;
    if (state.activeAlarms.has(sensorId)) return false;

    const alarm: AlarmState = {
      sensorId,
      sensorName,
      sensorKind,
      reading,
      triggeredAt: Date.now(),
      levelCode,
    };

    set((s) => {
      const next = new Map(s.activeAlarms);
      next.set(sensorId, alarm);
      return { activeAlarms: next };
    });

    return true;
  },

  acknowledge(sensorId) {
    if (!get().activeAlarms.has(sensorId)) return;
    set((s) => {
      const next = new Map(s.activeAlarms);
      next.delete(sensorId);
      return { activeAlarms: next };
    });
  },

  toggleSilent(sensorId) {
    set((s) => {
      const next = new Set(s.silenced);
      if (next.has(sensorId)) next.delete(sensorId);
      else next.add(sensorId);
      return { silenced: next };
    });
  },

  isSilent(sensorId) {
    return get().silenced.has(sensorId);
  },

  getTopAlarm() {
    const alarms = Array.from(get().activeAlarms.values());
    if (alarms.length === 0) return null;
    return alarms.sort((a, b) => a.triggeredAt - b.triggeredAt)[0] ?? null;
  },
}));
