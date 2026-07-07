import type { Category, PaletteMode } from "@hydris/ui/command-palette/palette-reducer";
import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import {
  Mountain,
  Plane,
  Radio,
  Rss,
  Satellite,
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

export type TrailSegment = {
  label: string;
  index: number;
};

export function getTrailSegments(
  stack: PaletteMode[],
  activeCategory: Category,
  rootQueryWasActive: boolean,
): TrailSegment[] {
  const rootLabel = rootQueryWasActive
    ? "Search"
    : (CATEGORIES.find((c) => c.id === activeCategory)?.label ?? activeCategory);

  const segments: TrailSegment[] = [{ label: rootLabel, index: -1 }];

  for (let i = 0; i < stack.length; i++) {
    const mode = stack[i]!;
    let label: string;
    switch (mode.kind) {
      case "dimension":
        label = mode.dimensionLabel;
        break;
      case "entity-actions":
        label = mode.entityLabel;
        break;
      case "location-search":
        label = "Go to location";
        break;
      case "config":
        label = "Configuration";
        break;
      case "asset-readiness":
        label = "Asset readiness";
        break;
      case "command-group":
        label = mode.groupLabel;
        break;
      case "mission-health":
        label = "Mission health";
        break;
      case "diagnostic-export":
        label = "Report a bug";
        break;
      case "mission-export":
        label = "Export mission pack";
        break;
      default:
        label = "Root";
        break;
    }
    segments.push({ label, index: i });
  }

  return segments;
}

export function classifyEntity(entity: Entity): Category | null {
  if (entity.camera) return "cameras";
  if (isTrack(entity)) return "tracks";
  if (isAsset(entity)) return "assets";
  // internal entities (track history shapes, config-only, service scaffolding) — not searchable
  return null;
}

export const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: "commands", label: "Commands", icon: Zap },
  { id: "assets", label: "Assets", icon: Radio },
  { id: "cameras", label: "Cameras", icon: Video },
  { id: "tracks", label: "Tracks", icon: Rss },
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

export type DimensionGroup = {
  dimension: string;
  label: string;
  count: number;
  battleDimension?: string;
};

export function groupByDimension(
  entities: Map<string, Entity>,
  category: Category,
): DimensionGroup[] {
  const counts = new Map<string, number>();

  for (const entity of entities.values()) {
    if (classifyEntity(entity) !== category) continue;
    const dim = getBattleDimension(entity);
    counts.set(dim, (counts.get(dim) ?? 0) + 1);
  }

  const result: DimensionGroup[] = [];
  for (const [dimension, count] of counts) {
    result.push({ dimension, label: dimension, count });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

export function groupByAssetCategory(entities: Map<string, Entity>): DimensionGroup[] {
  const counts = new Map<string, { count: number; battleDimension: string | undefined }>();
  for (const entity of entities.values()) {
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
