"use no memo";

import type { BadgeVariant } from "@hydris/ui/badge";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { FileQuestion, Zap } from "lucide-react-native";
import * as icons from "lucide-react-native/icons";

import { isAsset } from "../../../lib/api/use-track-utils";
import type { TileVariant } from "../../mission/provider-state";
import { getOwnState } from "../../mission/provider-state";
import { getNamingConfigurable, hasRaisedLink } from "../../mission/sources";

export function getEntityTypeLabel(entity: Entity): string {
  if (entity.config && !entity.geo) return "Config";
  if (entity.camera) return "Camera";
  if (isAsset(entity)) return "Asset";
  if (entity.device) return "Device";
  if (entity.track) return "Track";
  return "Entity";
}

function kebabToPascal(name: string): string {
  return name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

export const UNKNOWN_ICON: LucideIcon = FileQuestion;

function lucideIcon(name: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;

  const key = kebabToPascal(name) as keyof typeof icons;

  return (icons[key] as LucideIcon | undefined) ?? fallback;
}

export function getEntityIcon(entity: Entity): LucideIcon {
  return lucideIcon(entity.interactivity?.icon, UNKNOWN_ICON);
}

export function getTaskableIcon(entity: Entity): LucideIcon {
  return lucideIcon(entity.taskable?.icon, Zap);
}

export type ConfigStateBadge = { label: string; variant: BadgeVariant };

const VARIANT_BADGE: Partial<Record<TileVariant, BadgeVariant>> = {
  success: "success",
  pending: "pending",
  alert: "danger",
};

// Starting and Inactive deliberately have no badge.
export function getConfigStateBadge(entity: Entity): ConfigStateBadge | null {
  if (!entity.configurable && !entity.device) return null;

  const starting =
    getNamingConfigurable(entity)?.state === ConfigurableState.ConfigurableStateStarting;

  if (starting && !hasRaisedLink(entity)) return null;

  const { label, variant } = getOwnState(entity, true);
  const badge = VARIANT_BADGE[variant];

  return badge ? { label, variant: badge } : null;
}
