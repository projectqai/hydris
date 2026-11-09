import type { Category, PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import {
  Activity,
  Focus,
  Mountain,
  Plane,
  Radio,
  Satellite,
  ShieldHalf,
  Ship,
  Video,
  Waves,
  Zap,
} from "lucide-react-native";

import {
  getAssetCategory,
  getBattleDimension,
  isAsset,
  isTrack,
} from "../../../../lib/api/use-track-utils";

export { getAssetCategory, getBattleDimension };

export function addDeviceMode(serviceId: string): PaletteMode {
  return { kind: "config", entityId: serviceId, adding: true };
}

export function classifyEntity(entity: Entity): Category | null {
  if (entity.camera) return "cameras";
  if (isTrack(entity)) return "tracks";
  if (isAsset(entity)) return "assets";
  // internal entities (track history shapes, config-only, service scaffolding) — not searchable
  return null;
}

export const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: "mission", label: "Mission", icon: ShieldHalf },
  { id: "commands", label: "Commands", icon: Zap },
  { id: "assets", label: "Assets", icon: Radio },
  { id: "cameras", label: "Cameras", icon: Video },
  { id: "tracks", label: "Tracks", icon: Focus },
];

export const CATEGORY_LABEL: Record<string, string> = {};

export const COMMAND_SUBCATEGORIES: { id: string; label: string }[] = [
  { id: "world", label: "World" },
  { id: "display", label: "Display" },
  { id: "layout", label: "Layout" },
  { id: "map", label: "Map" },
  { id: "overlay", label: "Overlays" },
  { id: "preset", label: "Presets" },
  { id: "selection", label: "Selection" },
  { id: "sharing", label: "Sharing" },
];

export const DIMENSION_ICON: Record<string, LucideIcon> = {
  Air: Plane,
  Ground: Mountain,
  "Sea Surface": Ship,
  Subsurface: Waves,
  Space: Satellite,
};

export const SOURCE_ICON: LucideIcon = Activity;

export type DimensionGroup = {
  dimension: string;
  label: string;
  count: number;
  battleDimension?: string;
};

export function groupByAssetCategory(entities: Entity[]): DimensionGroup[] {
  const counts = new Map<string, { count: number; battleDimension: string | undefined }>();

  for (const entity of entities) {
    if (classifyEntity(entity) !== "assets") continue;
    const cat = getAssetCategory(entity);
    const dim = getBattleDimension(entity);
    const existing = counts.get(cat);
    if (existing) {
      existing.count++;
      // a bucket spanning multiple dimensions has no single icon
      if (existing.battleDimension !== dim) existing.battleDimension = undefined;
    } else {
      counts.set(cat, { count: 1, battleDimension: dim });
    }
  }
  const result: DimensionGroup[] = [];
  for (const [dimension, { count, battleDimension }] of counts) {
    result.push({ dimension, label: dimension, count, battleDimension });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}
