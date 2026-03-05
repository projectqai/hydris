"use no memo";

import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import { FileQuestion } from "lucide-react-native";
import * as icons from "lucide-react-native/icons";

export function getEntityTypeLabel(entity: Entity): string {
  if (entity.config && !entity.geo) return "Config";
  if (entity.camera) return "Camera";
  if (entity.device) return "Device";
  if (entity.track) return "Track";
  if (entity.symbol && entity.geo) return "Asset";
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

export type ConfigStateLabel = "Active" | "Failed" | "Scheduled";

export function getConfigState(entity: Entity): ConfigStateLabel | null {
  if (!entity.configurable) return null;
  if (entity.configurable.state === ConfigurableState.ConfigurableStateFailed) return "Failed";
  if (entity.configurable.state === ConfigurableState.ConfigurableStateActive) return "Active";
  if (entity.configurable.state === ConfigurableState.ConfigurableStateScheduled)
    return "Scheduled";
  return null;
}

const CONFIG_STATE_BADGE_VARIANT: Record<ConfigStateLabel, "danger" | "pending" | "success"> = {
  Failed: "danger",
  Active: "success",
  Scheduled: "success",
};

export function getConfigStateBadgeVariant(
  state: ConfigStateLabel,
): "danger" | "pending" | "success" {
  return CONFIG_STATE_BADGE_VARIANT[state];
}
