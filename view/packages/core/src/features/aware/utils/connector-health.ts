import type { ConnectorHealth } from "@hydris/map-engine/types";
import type { Entity } from "@projectqai/proto/world";

import type { TileVariant } from "../../mission/provider-state";
import { getOwnState } from "../../mission/provider-state";

const HEALTH: Partial<Record<TileVariant, ConnectorHealth>> = {
  success: "healthy",
  pending: "degraded",
  alert: "failed",
};

function isConnector(entity: Entity): boolean {
  return !!(entity.configurable || entity.device);
}

export function deriveConnectorHealth(entity: Entity): ConnectorHealth | undefined {
  // a link on a plain asset is that asset's comms, not a connector
  if (!isConnector(entity)) return undefined;

  // the map redraws only changed entities and would miss a connection or service change, so it
  // reads as vouched
  return HEALTH[getOwnState(entity, true).variant];
}
