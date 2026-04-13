"use no memo";

import { useAudioPlayer } from "expo-audio";
import { useEffect } from "react";

const alertSound = require("./assets/alert.mp3") as number;

export function useAlarmAudio() {
  const player = useAudioPlayer(alertSound);

  useEffect(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    player.loop = true;
  }, [player]);

  return player;
}
