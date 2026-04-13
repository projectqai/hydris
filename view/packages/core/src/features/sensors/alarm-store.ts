import { create } from "zustand";

import type { SensorKind, SensorReading } from "./types";

const ALARM_COOLDOWN_MS = 180_000;

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
  cooldowns: Map<string, number>;
  silenced: Set<string>;

  trigger: (
    sensorId: string,
    sensorName: string,
    sensorKind: SensorKind,
    reading: SensorReading,
    levelCode?: string,
  ) => boolean;
  acknowledge: (sensorId: string) => void;
  abortCooldown: (sensorId: string, levelCode?: string) => void;
  isCoolingDown: (sensorId: string, levelCode?: string) => boolean;
  toggleSilent: (sensorId: string) => void;
  isSilent: (sensorId: string) => boolean;
  getTopAlarm: () => AlarmState | null;
};

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCooldownExpiry(
  get: () => AlarmStore,
  set: (fn: (s: AlarmStore) => Partial<AlarmStore>) => void,
) {
  if (expiryTimer) clearTimeout(expiryTimer);

  const cooldowns = get().cooldowns;
  if (cooldowns.size === 0) return;

  const now = Date.now();
  const nextExpiry = Math.min(...cooldowns.values());
  const delay = Math.max(0, nextExpiry - now + 100);

  expiryTimer = setTimeout(() => {
    set((s) => {
      const currentTime = Date.now();
      const next = new Map<string, number>();
      for (const [key, until] of s.cooldowns) {
        if (until > currentTime) next.set(key, until);
      }
      return { cooldowns: next };
    });
    scheduleCooldownExpiry(get, set);
  }, delay);
}

export const useAlarmStore = create<AlarmStore>((set, get) => ({
  activeAlarms: new Map(),
  cooldowns: new Map(),
  silenced: new Set(),

  trigger(sensorId, sensorName, sensorKind, reading, levelCode) {
    const state = get();

    if (state.silenced.has(sensorId)) return false;
    if (state.activeAlarms.has(sensorId)) return false;

    const cooldownKey = levelCode ? `${sensorId}:${levelCode}` : sensorId;
    const cooldownUntil = state.cooldowns.get(cooldownKey);
    if (cooldownUntil && cooldownUntil > Date.now()) return false;

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
    const alarm = get().activeAlarms.get(sensorId);
    if (!alarm) return;

    const cooldownKey = alarm.levelCode ? `${sensorId}:${alarm.levelCode}` : sensorId;
    const cooldownUntil = Date.now() + ALARM_COOLDOWN_MS;

    set((s) => {
      const nextAlarms = new Map(s.activeAlarms);
      nextAlarms.delete(sensorId);
      const nextCooldowns = new Map(s.cooldowns);
      nextCooldowns.set(cooldownKey, cooldownUntil);
      return { activeAlarms: nextAlarms, cooldowns: nextCooldowns };
    });
    scheduleCooldownExpiry(get, set);
  },

  abortCooldown(sensorId, levelCode) {
    set((s) => {
      const next = new Map(s.cooldowns);
      if (levelCode) {
        next.delete(`${sensorId}:${levelCode}`);
      } else {
        for (const key of next.keys()) {
          if (key === sensorId || key.startsWith(`${sensorId}:`)) {
            next.delete(key);
          }
        }
      }
      return { cooldowns: next };
    });
  },

  isCoolingDown(sensorId, levelCode) {
    const key = levelCode ? `${sensorId}:${levelCode}` : sensorId;
    const until = get().cooldowns.get(key);
    return !!until && until > Date.now();
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
