"use no memo";

import type { BadgeVariant } from "@hydris/ui/badge";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { FileQuestion } from "lucide-react-native";
import * as icons from "lucide-react-native/icons";

import { isAsset } from "../../../lib/api/use-track-utils";
import { formatConfigurableState } from "./format-entity";

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

export function getEntityIcon(entity: Entity): LucideIcon {
  const iconName = entity.interactivity?.icon;
  if (iconName) {
    const key = kebabToPascal(iconName) as keyof typeof icons;
    const resolved = icons[key] as LucideIcon | undefined;
    if (resolved) return resolved;
  }
  return FileQuestion;
}

export type ConfigStateBadge = { label: string; variant: BadgeVariant };

const CONFIG_STATE_VARIANT: Partial<Record<ConfigurableState, BadgeVariant>> = {
  [ConfigurableState.ConfigurableStateActive]: "success",
  [ConfigurableState.ConfigurableStateScheduled]: "success",
  [ConfigurableState.ConfigurableStateFailed]: "danger",
  [ConfigurableState.ConfigurableStateConflict]: "danger",
};

// Starting and Inactive deliberately have no badge.
export function getConfigStateBadge(entity: Entity): ConfigStateBadge | null {
  const s = entity.configurable?.state;
  if (s === undefined) return null;
  const variant = CONFIG_STATE_VARIANT[s];
  return variant ? { label: formatConfigurableState(s).label, variant } : null;
}
