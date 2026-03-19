import { clone, create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { Entity } from "@projectqai/proto/world";
import {
  ConfigurationComponentSchema,
  DeviceComponentSchema,
  EntitySchema,
  GeoSpatialComponentSchema,
  LifetimeSchema,
} from "@projectqai/proto/world";
import { getRandomValues } from "expo-crypto";
import { useState } from "react";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { worldClient } from "./world-client";

function randomHex8(): string {
  const bytes = new Uint8Array(4);
  getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export function useEntityMutation() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const updateEntity = useEntityStore((s) => s.updateEntity);

  const updateEntityLocation = async (
    entity: Entity,
    geo: { latitude: number; longitude: number; altitude: number },
  ) => {
    const previousGeo = entity.geo;
    const geoComponent = create(GeoSpatialComponentSchema, geo);

    setIsPending(true);
    setError(null);
    updateEntity(entity.id, { geo: geoComponent });

    try {
      const response = await worldClient.push({
        changes: [{ ...entity, geo: geoComponent }],
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
          {
            ...entity,
            config: configComponent,
            lifetime: create(LifetimeSchema, { from: timestampNow() }),
          },
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
    pushDeviceConfig,
    removeDeviceConfig,
    createDevice,
    deleteDevice,
    isPending,
    error,
  };
}
