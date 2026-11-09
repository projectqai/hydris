import type { EditKind } from "@hydris/map-engine/types";
import type { LucideIcon } from "lucide-react-native";
import { Circle, Crosshair, PersonStanding, Ruler, Square, Waypoints } from "lucide-react-native";

export const TOOL_ICON: Record<EditKind | "bullseye", LucideIcon> = {
  range: Ruler,
  "rb-circle": Crosshair,
  bullseye: PersonStanding,
  circle: Circle,
  rectangle: Square,
  freeform: Waypoints,
};
