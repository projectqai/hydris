import { useEffect, useEffectEvent, useRef, useState } from "react";

import { HOLD_DURATION_MS, HOLD_RELEASE_MS } from "../hold-label";
import { holdToConfirmEnabled } from "./hold-to-confirm-flag";
import { useHoldToConfirm } from "./use-hold-to-confirm";

// A press from rest shorter than this is a tap, so a quick tap never flashes the hold fill
export const PRESS_START_MS = 150;

// An item a tap left waiting returns to rest this long after the tap, or after a hold let go early
export const CONFIRM_LAPSE_MS = 6000;

// A control confirmed by holding. A tap leaves an item waiting for a hold.
// A press from rest starts the hold after a moment. It leaves the item waiting only if it ends as a
// tap, so a touch that turns into a scroll changes nothing.
// The caller keeps which item a tap left waiting.
export function useConfirmPress({
  tapped,
  focused,
  canConfirm,
  onConfirm,
  onLapse,
  confirmedMs = 0,
}: {
  tapped: string | undefined;
  focused: string | undefined;
  canConfirm: (item: string) => boolean;
  onConfirm: (item: string) => void;
  onLapse: (item: string) => void;
  confirmedMs?: number;
}) {
  const [pressed, setPressed] = useState<string>();
  // What letting go of the press does. A hold that completed already acted, so its release must
  // not reach the item again, now running, as a tap.
  const release = useRef<"nothing" | "tap">("tap");
  const starting = useRef<ReturnType<typeof setTimeout>>(undefined);
  const confirming = pressed !== undefined && canConfirm(pressed) ? pressed : tapped;

  const hold = useHoldToConfirm({
    onConfirm: () => {
      if (confirming === undefined) return;

      release.current = "nothing";
      setPressed(undefined);
      onConfirm(confirming);
    },
    duration: HOLD_DURATION_MS,
    confirmedMs,
    releaseMs: HOLD_RELEASE_MS,
    active: confirming !== undefined && (focused === confirming || pressed === confirming),
  });

  useEffect(() => () => clearTimeout(starting.current), []);

  const holding = hold.remaining !== null;
  const lapse = useEffectEvent(onLapse);

  useEffect(() => {
    if (tapped === undefined || holding) return;

    const timer = setTimeout(() => lapse(tapped), CONFIRM_LAPSE_MS);

    return () => clearTimeout(timer);
  }, [tapped, holding]);

  const pressIn = (item: string) => {
    release.current = item === tapped ? "nothing" : "tap";

    if (item === tapped) {
      hold.onPressIn();

      return;
    }

    if (!canConfirm(item) || !holdToConfirmEnabled()) return;

    starting.current = setTimeout(() => {
      setPressed(item);
      hold.onPressIn();
    }, PRESS_START_MS);
  };

  const pressOut = () => {
    clearTimeout(starting.current);

    // A completed hold still shows full until it confirms, so letting go changes nothing
    if (hold.remaining === 0) {
      release.current = "nothing";

      return;
    }

    setPressed(undefined);
    hold.onPressOut();
  };

  return {
    confirming,
    holding,
    progress: hold.progress,
    pressIn,
    pressOut,
    releasedAsTap: () => release.current === "tap",
    stopHold: hold.onPressOut,
  };
}
