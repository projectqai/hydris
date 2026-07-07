import type { BadgeVariant } from "@hydris/ui/badge";
import type { Entity } from "@projectqai/proto/world";
import { ClassificationIdentity } from "@projectqai/proto/world";
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
 * Assets are entities with a device and a symbol. Gated on device.state,
 * not just the device component, so it holds if state becomes optional.
 */
export function isAsset(entity: Entity): boolean {
  return entity.device?.state != null && entity.symbol != null;
}

/**
 * Repositionable entities can be placed or moved on the map by the user.
 */
export function isRepositionable(entity: Entity): boolean {
  return entity.symbol != null && entity.pose == null;
}

/**
 * Detections are entities marked with the DetectionComponent (contact reports).
 */
export function isDetectionEntity(entity: Entity): boolean {
  return entity.detection != null;
}

function primaryTaxonomy(entity: Entity) {
  return entity.classification?.taxonomy?.find((t) => t.kind.case != null);
}

function formatKindLabel(kind: string): string {
  return kind
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Asset category is the taxonomy kind's own name, title-cased, so a new kind
 * needs no client change. Entities the engine leaves unclassified get their
 * own bucket.
 */
export function getAssetCategory(entity: Entity): string {
  const kind = primaryTaxonomy(entity)?.kind.case;
  return kind ? formatKindLabel(kind) : "Unclassified";
}

// SIDC battle-dimension position [2]. rank orders space, air, ground, sea, subsurface for sorting.
const SIDC_DIMENSION: Record<string, { label: string; rank: number }> = {
  P: { label: "Space", rank: 2 },
  A: { label: "Air", rank: 3 },
  G: { label: "Ground", rank: 4 },
  S: { label: "Sea Surface", rank: 5 },
  U: { label: "Subsurface", rank: 6 },
};

/** Battle dimension label from the engine-populated SIDC position [2]. */
export function getBattleDimension(entity: Entity): string {
  const char = entity.symbol?.milStd2525C?.[2]?.toUpperCase();
  return char ? (SIDC_DIMENSION[char]?.label ?? "Unknown") : "Unknown";
}

/** Battle dimension as a sortable rank, zero when the entity carries no dimension. */
export function getBattleDimensionRank(entity: Entity): number {
  const char = entity.symbol?.milStd2525C?.[2]?.toUpperCase();
  return char ? (SIDC_DIMENSION[char]?.rank ?? 0) : 0;
}
