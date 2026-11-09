import { clone, create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { MapPath } from "@hydris/map-engine/geometry/rendered-paths";
import type { EditKind, PathPoint } from "@hydris/map-engine/types";
import { MetricComponentSchema } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import {
  ChannelSchema,
  ConfigurationComponentSchema,
  ControllerSchema,
  DeviceComponentSchema,
  EntitySchema,
  GeoSpatialComponentSchema,
  LifetimeSchema,
  RoutingSchema,
} from "@projectqai/proto/world";
import { getRandomValues } from "expo-crypto";
import { useState } from "react";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { hasEnoughPoints, TOOL } from "../../features/aware/utils/map-paths";
import { CONTROLLER_ID } from "./controller-id";
import { worldClient } from "./world-client";
import { writeDrawing, writeMetrics } from "./write-drawing";

function randomHex8(): string {
  const bytes = new Uint8Array(4);
  getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export async function updateDrawing(
  entity: Entity,
  kind: EditKind,
  points: readonly PathPoint[],
  rings?: number,
  radiusM?: number,
): Promise<void> {
  if (kind === "range" && points.length < 2) {
    throw new Error("A range and bearing needs at least two points");
  }

  const { updateEntity } = useEntityStore.getState();
  const previousShape = entity.shape;
  const previousMetric = entity.metric;
  const shapeComponent = writeDrawing(kind, points, rings, radiusM);
  const metricComponent = writeMetrics(kind, points, rings, radiusM);
  updateEntity(entity.id, { shape: shapeComponent, metric: metricComponent });

  try {
    const lifetime = create(LifetimeSchema, { from: timestampNow() });
    const changes = [
      create(EntitySchema, {
        id: entity.id,
        shape: shapeComponent,
        metric: metricComponent,
        lifetime,
      }),
    ];
    if (metricComponent === undefined && previousMetric !== undefined) {
      // The separate permanent shape update keeps the entity alive when metrics expire.
      changes.push(
        create(EntitySchema, {
          id: entity.id,
          metric: create(MetricComponentSchema),
          lifetime: create(LifetimeSchema, { from: lifetime.from, until: lifetime.from }),
        }),
      );
    }
    const response = await worldClient.push({ changes });

    if (!response.accepted) {
      throw new Error(response.debug || "Server rejected update");
    }
  } catch (err) {
    updateEntity(entity.id, { shape: previousShape, metric: previousMetric });
    throw err;
  }
}

export async function pushPath(path: MapPath): Promise<string> {
  if (!hasEnoughPoints(path)) throw new Error(`${TOOL[path.kind].label} is missing points`);

  const shape = writeDrawing(path.kind, path.points, path.rings, path.radiusM);
  const metric = writeMetrics(path.kind, path.points, path.rings, path.radiusM);
  const { nodeId } = await worldClient.getLocalNode({});
  const id = `hydris.${TOOL[path.kind].idPrefix}.${nodeId}.${randomHex8()}`;

  const response = await worldClient.push({
    changes: [
      create(EntitySchema, {
        id,
        label: TOOL[path.kind].label,
        controller: create(ControllerSchema, { id: CONTROLLER_ID }),
        shape,
        metric,
        routing: create(RoutingSchema, { channels: [create(ChannelSchema, {})] }),
        lifetime: create(LifetimeSchema, { from: timestampNow() }),
      }),
    ],
  });

  if (!response.accepted) {
    throw new Error(response.debug || `Server rejected ${TOOL[path.kind].label}`);
  }

  return id;
}

export function useEntityMutation() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const updateEntity = useEntityStore((s) => s.updateEntity);

  const updateEntityLocation = async (
    entity: Entity,
    geo: { latitude: number; longitude: number; altitude?: number },
  ) => {
    const previousGeo = entity.geo;
    const geoComponent = create(GeoSpatialComponentSchema, {
      ...previousGeo,
      latitude: geo.latitude,
      longitude: geo.longitude,
      ...(geo.altitude !== undefined && { altitude: geo.altitude }),
    });

    setIsPending(true);
    setError(null);
    updateEntity(entity.id, { geo: geoComponent });

    try {
      const response = await worldClient.push({
        changes: [
          create(EntitySchema, {
            id: entity.id,
            geo: geoComponent,
            lifetime: create(LifetimeSchema, { from: timestampNow() }),
          }),
        ],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected update");
      }
    } catch (err) {
      updateEntity(entity.id, { geo: previousGeo });
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const updateEntityConfig = async (entity: Entity, value: JsonObject) => {
    if (!entity.config) return;

    const previousConfig = entity.config;
    const configComponent = create(ConfigurationComponentSchema, {
      ...entity.config,
      value,
    });

    setIsPending(true);
    setError(null);
    updateEntity(entity.id, { config: configComponent });

    try {
      const response = await worldClient.push({
        changes: [
          create(EntitySchema, {
            id: entity.id,
            config: configComponent,
            lifetime: create(LifetimeSchema, { from: timestampNow() }),
          }),
        ],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected update");
      }
    } catch (err) {
      updateEntity(entity.id, { config: previousConfig });
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const updateRb = async (entity: Entity, points: readonly PathPoint[]) => {
    setIsPending(true);
    setError(null);
    try {
      await updateDrawing(entity, "range", points);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const pushDeviceConfig = async (
    entity: Entity,
    value: JsonObject,
  ): Promise<{ version: bigint }> => {
    const version = (entity.config?.version ?? 0n) + 1n;

    const configComponent = create(ConfigurationComponentSchema, {
      value,
      version,
    });

    setIsPending(true);
    setError(null);

    try {
      const response = await worldClient.push({
        changes: [
          create(EntitySchema, {
            id: entity.id,
            config: configComponent,
            lifetime: create(LifetimeSchema, { from: timestampNow() }),
          }),
        ],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected config update");
      }

      return { version };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const createDevice = async (parentId: string, deviceClass: string): Promise<string> => {
    const id = `${parentId}.${deviceClass}.${randomHex8()}`;

    setIsPending(true);
    setError(null);

    try {
      const response = await worldClient.push({
        changes: [
          create(EntitySchema, {
            id,
            device: create(DeviceComponentSchema, { parent: parentId, class: deviceClass }),
          }),
        ],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected device creation");
      }

      return id;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const removeDeviceConfig = async (entity: Entity) => {
    setIsPending(true);
    setError(null);

    try {
      const replacement = clone(EntitySchema, entity);
      replacement.config = undefined;
      const response = await worldClient.push({
        replacements: [replacement],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected config removal");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const deleteDevice = async (entityId: string) => {
    setIsPending(true);
    setError(null);

    try {
      await worldClient.expireEntity({ id: entityId });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  return {
    updateEntityLocation,
    updateEntityConfig,
    updateRb,
    pushDeviceConfig,
    removeDeviceConfig,
    createDevice,
    deleteDevice,
    isPending,
    error,
  };
}
