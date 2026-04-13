"use no memo";

import { useEffect } from "react";
import { Platform, Vibration } from "react-native";

import { useAlarmStore } from "../alarm-store";
import { useAlarmAudio } from "../use-alarm-audio";
import { useAlarmEffects } from "../use-alarm-effects";
import { AlarmModal } from "./alarm-modal";

const VIBRATION_PATTERN = [500, 250, 500, 250, 500];

export function AlarmOverlay() {
  useAlarmEffects();
  const topAlarm = useAlarmStore((s) => s.getTopAlarm());
  const acknowledge = useAlarmStore((s) => s.acknowledge);
  const player = useAlarmAudio();
  const isActive = !!topAlarm;

  useEffect(() => {
    if (!isActive) return;

    if (Platform.OS !== "web") {
      Vibration.vibrate(VIBRATION_PATTERN, true);
    }
    player.play();

    return () => {
      if (Platform.OS !== "web") {
        Vibration.cancel();
      }
      player.pause();
    };
  }, [isActive, player]);

  if (!topAlarm) return null;

  return <AlarmModal alarm={topAlarm} onAcknowledge={() => acknowledge(topAlarm.sensorId)} />;
}
