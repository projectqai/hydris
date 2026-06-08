import { create } from "@bufbuild/protobuf";
import { timestampFromMs, timestampNow } from "@bufbuild/protobuf/wkt";
import { ManualControlAxesSchema, ManualControlInputSchema } from "@projectqai/proto/manualcontrol";
import type { Entity } from "@projectqai/proto/world";
import {
  EntitySchema,
  LifetimeSchema,
  TargetManualControlComponentSchema,
} from "@projectqai/proto/world";
import { useCallback, useEffect, useRef } from "react";

import { worldClient } from "./world-client";

const TICK_MS = 66;
const TTL_MS = 100;

export type AxesInput = {
  forward?: number;
  right?: number;
  up?: number;
  yaw?: number;
  pitch?: number;
  pan?: number;
  tilt?: number;
  zoom?: number;
};

export function useManualControl(entity: Entity | undefined) {
  const enabled = Boolean(entity?.manualControl);
  const entityId = entity?.id;

  const axesRef = useRef<AxesInput>({});
  const activeRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flush = useCallback(async () => {
    if (!entityId) return;
    const axes = axesRef.current;
    const now = Date.now();
    try {
      await worldClient.push({
        changes: [
          create(EntitySchema, {
            id: entityId,
            targetManualControl: create(TargetManualControlComponentSchema, {
              input: [
                create(ManualControlInputSchema, {
                  axes: create(ManualControlAxesSchema, {
                    forward: axes.forward ?? 0,
                    right: axes.right ?? 0,
                    up: axes.up ?? 0,
                    yaw: axes.yaw ?? 0,
                    pitch: axes.pitch ?? 0,
                    pan: axes.pan ?? 0,
                    tilt: axes.tilt ?? 0,
                    zoom: axes.zoom ?? 0,
                  }),
                }),
              ],
            }),
            lifetime: create(LifetimeSchema, {
              from: timestampNow(),
              until: timestampFromMs(now + TTL_MS),
            }),
          }),
        ],
      });
    } catch {
      // best-effort; next tick will retry
    }
  }, [entityId]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    void flush();
    intervalRef.current = setInterval(() => void flush(), TICK_MS);
  }, [flush]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    activeRef.current = false;
    axesRef.current = { forward: 0, right: 0, pan: 0, tilt: 0 };
    void flush();
  }, [flush]);

  const setAxes = useCallback((axes: AxesInput) => {
    axesRef.current = axes;
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { enabled, start, stop, setAxes };
}
