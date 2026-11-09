import type { EditKind } from "@hydris/map-engine/types";

type InputCopy = {
  touch: string;
  pointer: string;
};

const PATH_STEPS = {
  range: [
    {
      touch: "Tap the start point or a track",
      pointer: "Click the start point or a track",
    },
    {
      touch: "Tap the far point or a track",
      pointer: "Click the far point or a track",
    },
  ],
  "rb-circle": [
    {
      touch: "Tap the centre point",
      pointer: "Click the centre point",
    },
    {
      touch: "Tap to set the radius",
      pointer: "Click to set the radius",
    },
  ],
  circle: [
    {
      touch: "Tap the centre point",
      pointer: "Click the centre point",
    },
    {
      touch: "Tap the edge to set the radius",
      pointer: "Click the edge to set the radius",
    },
  ],
  rectangle: [
    {
      touch: "Tap the first corner",
      pointer: "Click the first corner",
    },
    {
      touch: "Tap the next corner",
      pointer: "Click the next corner",
    },
    {
      touch: "Tap to set how deep",
      pointer: "Click to set how deep",
    },
  ],
  freeform: [
    {
      touch: "Tap the first point",
      pointer: "Click the first point",
    },
    {
      touch: "Keep tapping to add points",
      pointer: "Keep clicking to add points",
    },
    {
      touch: "Tap the first point to close, or Finish for a line",
      pointer: "Click the first point to close, or Finish for a line",
    },
  ],
} as const satisfies Record<EditKind, readonly InputCopy[]>;

const BULLSEYE_STEP: InputCopy = {
  touch: "Tap to place the bullseye",
  pointer: "Click to place the bullseye",
};

const PLACEMENT_STEP = "Pan the map, then Confirm";
const EDIT_STEP = "Drag a handle";
const TOUCH_FREEFORM_EDIT_STEP = "Drag a handle or hold a segment to add a point";

function inputCopy(copy: InputCopy, isTouchInput: boolean): string {
  return isTouchInput ? copy.touch : copy.pointer;
}

export type MapStepLineState = {
  isPlacing: boolean;
  editEntityId: string | null;
  editKind: EditKind;
  isTouchInput: boolean;
  isBullseyePlacing: boolean;
  pathKind: EditKind | null;
  pathPointCount: number;
};

export function resolveMapStepLine({
  isPlacing,
  editEntityId,
  editKind,
  isTouchInput,
  isBullseyePlacing,
  pathKind,
  pathPointCount,
}: MapStepLineState): string | null {
  if (isPlacing) return PLACEMENT_STEP;
  if (editEntityId) {
    return editKind === "freeform" && isTouchInput ? TOUCH_FREEFORM_EDIT_STEP : EDIT_STEP;
  }
  if (isBullseyePlacing) return inputCopy(BULLSEYE_STEP, isTouchInput);
  if (!pathKind) return null;

  const step =
    pathKind === "freeform" && pathPointCount >= 2
      ? PATH_STEPS.freeform[2]
      : PATH_STEPS[pathKind][pathPointCount];
  return step ? inputCopy(step, isTouchInput) : null;
}
