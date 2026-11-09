"use no memo";

import { CommandTrigger } from "@hydris/ui/top-bar/command-trigger";
import { memo, useContext } from "react";

import { useMissionState } from "../../../mission/use-mission-state";
import { PaletteContext } from "../../palette-context";

export const MissionCommandTrigger = memo(function MissionCommandTrigger() {
  const palette = useContext(PaletteContext);
  const status = useMissionState();

  return <CommandTrigger onPress={() => palette.open()} status={status} />;
});
