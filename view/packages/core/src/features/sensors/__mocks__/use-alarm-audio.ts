import { fn } from "storybook/test";

import type * as real from "../use-alarm-audio";

type Player = ReturnType<typeof real.useAlarmAudio>;

const player: Pick<Player, "loop" | "play" | "pause"> = {
  loop: true,
  play: fn<Player["play"]>().mockName("alarmPlayer.play"),
  pause: fn<Player["pause"]>().mockName("alarmPlayer.pause"),
};

export const useAlarmAudio = fn<() => typeof player>(() => player).mockName("useAlarmAudio");
