import type { BadgeVariant } from "@hydris/ui/badge";
import type { LucideIcon } from "lucide-react-native";
import { Circle, CircleAlert, CircleCheck, CircleMinus, CircleX } from "lucide-react-native";

import type { ReadinessGateStatus } from "./asset-readiness";

export type StatusColorKey =
  | "successForeground"
  | "redForeground"
  | "pendingForeground"
  | "iconMuted";

export const READINESS_VISUAL: Record<
  ReadinessGateStatus,
  { icon: LucideIcon; colorKey: StatusColorKey; variant: BadgeVariant }
> = {
  met: { icon: CircleCheck, colorKey: "successForeground", variant: "success" },
  failed: { icon: CircleX, colorKey: "redForeground", variant: "danger" },
  pending: { icon: Circle, colorKey: "pendingForeground", variant: "pending" },
  degraded: { icon: CircleAlert, colorKey: "pendingForeground", variant: "pending" },
  blocked: { icon: CircleMinus, colorKey: "iconMuted", variant: "neutral" },
  unmet: { icon: Circle, colorKey: "pendingForeground", variant: "pending" },
};
