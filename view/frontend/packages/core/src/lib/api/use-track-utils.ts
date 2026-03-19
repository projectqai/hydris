import type { BadgeVariant } from "@hydris/ui/badge";
import type { Entity } from "@projectqai/proto/world";
import { ClassificationBattleDimension, ClassificationIdentity } from "@projectqai/proto/world";
import { format } from "date-fns";

export type TrackStatus = "Blue" | "Red" | "Neutral" | "Unknown" | "Unclassified";
export type Timestamp = { seconds: bigint; nanos: number };

/**
 * Convert protobuf Timestamp to milliseconds since epoch
 */
export function timestampToMs(timestamp?: Timestamp): number {
  if (!timestamp) return 0;
  return Number(timestamp.seconds) * 1000 + Math.floor((timestamp.nanos || 0) / 1_000_000);
}

/**
 * Extract affiliation/status from entity classification identity,
 * falling back to SIDC position [1] if classification is not populated.
 */
export function getTrackStatus(entity: Entity): TrackStatus {
  switch (entity.classification?.identity) {
    case ClassificationIdentity.ClassificationIdentityFriend:
      return "Blue";
    case ClassificationIdentity.ClassificationIdentityHostile:
    case ClassificationIdentity.ClassificationIdentitySuspect:
      return "Red";
    case ClassificationIdentity.ClassificationIdentityNeutral:
      return "Neutral";
    case ClassificationIdentity.ClassificationIdentityUnknown:
    case ClassificationIdentity.ClassificationIdentityPending:
      return "Unknown";
    default:
      return "Unclassified";
  }
}

/**
 * Convert track status to badge variant using MILSYMBOL colors
 */
export function getStatusBadgeVariant(status: TrackStatus): BadgeVariant {
  if (status === "Blue") return "affiliation-blue";
  if (status === "Red") return "affiliation-red";
  if (status === "Neutral") return "affiliation-neutral";
  return "affiliation-unknown";
}

export function formatAltitude(altitudeMeters?: number): string {
  if (altitudeMeters == null) return "N/A";
  return `${Math.round(altitudeMeters)}m`;
}

export function formatTime(timestamp?: Timestamp): string {
  if (!timestamp) return "--:--:--";
  return format(new Date(timestampToMs(timestamp)), "HH:mm:ss");
}

export function getEntityName(entity: Entity): string {
  return entity.label || entity.id;
}

/**
 * Tracks are entities marked with the TrackComponent
 */
export function isTrack(entity: Entity): boolean {
  return !!(entity.geo && entity.symbol && entity.track);
}

/**
 * Assets are entities with geo and symbol but no track component
 */
export function isAsset(entity: Entity): boolean {
  return !entity.track && !!entity.symbol && !!entity.geo;
}

const GROUND_FUNCTION: Record<string, string> = {
  U: "Units",
  E: "Equipment",
  I: "Installations",
};

const AIR_FUNCTION: Record<string, string> = {
  M: "Military",
  C: "Civilian",
};

const SEA_FUNCTION: Record<string, string> = {
  C: "Combatant",
  N: "Non-Combatant",
};

const SUBSURFACE_FUNCTION: Record<string, string> = {
  S: "Submarine",
  W: "Weapon",
  N: "Non-Submarine",
};

const SPACE_FUNCTION: Record<string, string> = {
  S: "Military",
  V: "Civilian",
};

const FUNCTION_BY_DIMENSION: Record<string, Record<string, string>> = {
  G: GROUND_FUNCTION,
  A: AIR_FUNCTION,
  S: SEA_FUNCTION,
  U: SUBSURFACE_FUNCTION,
  P: SPACE_FUNCTION,
};

/**
 * Extract MIL-STD-2525C function category from SIDC position [4],
 * interpreted per battle dimension at position [2].
 */
export function getFunctionCategory(entity: Entity): string {
  const sidc = entity.symbol?.milStd2525C;
  if (!sidc || sidc.length < 5) return "Unknown";
  const dim = sidc[2]?.toUpperCase();
  const func = sidc[4]?.toUpperCase();
  if (!dim || !func) return "Unknown";
  return FUNCTION_BY_DIMENSION[dim]?.[func] ?? "Unknown";
}

const SIDC_DIMENSION: Record<string, string> = {
  A: "Air",
  G: "Ground",
  S: "Sea Surface",
  U: "Subsurface",
  P: "Space",
};

/**
 * Extract battle dimension from classification component,
 * falling back to SIDC position [2].
 */
export function getBattleDimension(entity: Entity): string {
  const dim = entity.classification?.dimension;
  if (dim != null && dim !== ClassificationBattleDimension.ClassificationBattleDimensionInvalid) {
    const label = DIMENSION_LABELS[dim];
    if (label) return label;
  }
  const char = entity.symbol?.milStd2525C?.[2]?.toUpperCase();
  return (char && SIDC_DIMENSION[char]) ?? "Unknown";
}

const DIMENSION_LABELS: Partial<Record<ClassificationBattleDimension, string>> = {
  [ClassificationBattleDimension.ClassificationBattleDimensionAir]: "Air",
  [ClassificationBattleDimension.ClassificationBattleDimensionGround]: "Ground",
  [ClassificationBattleDimension.ClassificationBattleDimensionSeaSurface]: "Sea Surface",
  [ClassificationBattleDimension.ClassificationBattleDimensionSubsurface]: "Subsurface",
  [ClassificationBattleDimension.ClassificationBattleDimensionSpace]: "Space",
  [ClassificationBattleDimension.ClassificationBattleDimensionUnknown]: "Unknown",
};

export function isExpired(entity: Entity): boolean {
  if (!entity.lifetime?.until) return false;
  return timestampToMs(entity.lifetime.until) < Date.now();
}
