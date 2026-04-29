import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { Entity } from "@projectqai/proto/world";
import {
  EntitySchema,
  LifetimeSchema,
  PolarOffsetSchema,
  TargetPoseComponentSchema,
} from "@projectqai/proto/world";
import { useCallback } from "react";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { nextAzimuth } from "./camera-pan-math";
import { worldClient } from "./world-client";

export function useCameraPan(camera: Entity | undefined) {
  const focalPointId = camera?.camera?.focalPoint;
  const focalPoint = useEntityStore((s) =>
    focalPointId ? s.entities.get(focalPointId) : undefined,
  );

  const targetPolar =
    focalPoint?.targetPose?.offset.case === "polar"
      ? focalPoint.targetPose.offset.value
      : undefined;
  const posePolar =
    focalPoint?.pose?.offset.case === "polar" ? focalPoint.pose.offset.value : undefined;
  const polar = targetPolar ?? posePolar;

  const enabled = Boolean(focalPointId) && polar !== undefined;

  const pan = useCallback(
    async (deltaFraction: number) => {
      if (!focalPointId || !polar) return;
      const nextAz = nextAzimuth(polar.azimuth, deltaFraction);
      if (nextAz === null) return;

      // Driver treats missing elevation/range as 0, so echo current to avoid snap-to-horizon.
      const nextPolar = create(PolarOffsetSchema, {
        azimuth: nextAz,
        ...(polar.elevation !== undefined && { elevation: polar.elevation }),
        ...(polar.range !== undefined && { range: polar.range }),
      });

      try {
        await worldClient.push({
          changes: [
            create(EntitySchema, {
              id: focalPointId,
              targetPose: create(TargetPoseComponentSchema, {
                offset: { case: "polar", value: nextPolar },
              }),
              lifetime: create(LifetimeSchema, { from: timestampNow() }),
            }),
          ],
        });
      } catch (err) {
        console.warn("camera pan failed", err);
      }
    },
    [focalPointId, polar],
  );

  return { enabled, pan };
}
