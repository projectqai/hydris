import { geodesicDistance } from "@hydris/map-engine/utils/geodesy";
import { Badge } from "@hydris/ui/badge";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { MiddleTruncateText } from "@hydris/ui/middle-truncate-text";
import type { Entity } from "@projectqai/proto/world";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Compass,
  MapPin,
  Mountain,
  Navigation,
  Radio,
  Ruler,
  Wifi,
  Zap,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import {
  formatAltitude,
  formatTime,
  getEntityName,
  getLastSeen,
  getStatusBadgeVariant,
  getTrackStatus,
} from "../../lib/api/use-track-utils";
import type { TileVariant } from "../mission/provider-state";
import { useOwnState } from "../mission/use-mission-state";
import { selectSelfGeo, useEntityStore } from "./store/entity-store";
import {
  deriveAssetReadiness,
  gateValue,
  type ReadinessGate,
  worstBlocker,
} from "./utils/asset-readiness";
import {
  calculateCourseFromVelocity,
  calculateGroundSpeed,
  calculateHeadingFromOrientation,
  formatDistance,
} from "./utils/format-kinematics";
import { READINESS_VISUAL } from "./utils/readiness-display";

type CardRootProps = {
  isSelected?: boolean;
  onPress?: () => void;
  children: ReactNode;
};

function CardRoot({ isSelected, onPress, children }: CardRootProps) {
  const t = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isLight = colorScheme === "light";

  return (
    <Pressable
      className={cn(
        "mb-1 rounded-md border px-2.5 py-2 select-none",
        isSelected
          ? "bg-foreground/10 border-foreground/50"
          : isLight
            ? "bg-card border-border/50 hover:bg-accent active:bg-muted"
            : "bg-foreground/5 border-border/30 hover:bg-foreground/[0.08] active:bg-foreground/10",
      )}
      // @ts-ignore react-native-web CSS property
      style={{ boxShadow: t.cardShadow }}
      onPress={onPress}
      role="button"
      aria-pressed={isSelected ?? false}
    >
      {children}
    </Pressable>
  );
}

type CardHeaderProps = {
  title: string;
  tailLength?: number;
  right?: ReactNode;
};

function CardHeader({ title, tailLength, right }: CardHeaderProps) {
  const titleClassName = "font-sans-semibold text-foreground text-13";

  return (
    <View className="mb-1.5 flex-row items-center justify-between gap-2">
      {tailLength === undefined ? (
        <Text className={cn(titleClassName, "flex-1")} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View className="min-w-0 flex-1">
          <MiddleTruncateText text={title} tailLength={tailLength} className={titleClassName} />
        </View>
      )}
      {right}
    </View>
  );
}

function CardRow({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1">{children}</View>;
}

type DataItemProps = {
  icon: typeof Clock;
  value: string;
};

function DataItem({ icon: Icon, value }: DataItemProps) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center gap-1">
      <Icon size={11} color={t.iconSubtle} strokeWidth={1.5} />
      <Text className="font-sans-medium text-foreground/80 text-11">{value}</Text>
    </View>
  );
}

function SourceItem({ icon: Icon, value }: { icon: typeof Radio; value: string }) {
  const t = useThemeColors();
  return (
    <View className="min-w-0 shrink flex-row items-center gap-1">
      <View className="shrink-0">
        <Icon size={11} color={t.iconSubtle} strokeWidth={1.5} />
      </View>
      <Text className="font-sans-medium text-foreground/80 text-11 shrink" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const STATE_VISUAL: Record<
  TileVariant,
  { icon: typeof Circle; colorKey: "iconMuted" | "pendingForeground" | "redForeground" }
> = {
  success: { icon: CircleCheck, colorKey: "iconMuted" },
  default: { icon: Circle, colorKey: "iconMuted" },
  pending: { icon: CircleAlert, colorKey: "pendingForeground" },
  alert: { icon: CircleX, colorKey: "redForeground" },
};

function StatusItem({ entity }: { entity: Entity }) {
  const t = useThemeColors();
  const state = useOwnState(entity);
  const { icon: Icon, colorKey } = STATE_VISUAL[state.variant];
  const color = t[colorKey];
  const isCalm = colorKey === "iconMuted";
  return (
    <View className="flex-row items-center gap-1">
      <Icon size={11} color={color} strokeWidth={1.5} />
      <Text
        className={cn("font-sans-medium text-11", isCalm && "text-foreground/80")}
        style={isCalm ? undefined : { color }}
      >
        {state.label}
      </Text>
    </View>
  );
}

function ReadinessBlockerItem({ entity, gate }: { entity: Entity; gate: ReadinessGate }) {
  const t = useThemeColors();
  const Icon = gate.key === "link" ? Wifi : MapPin;
  const color = t[READINESS_VISUAL[gate.status].colorKey];
  return (
    <View className="flex-row items-center gap-1">
      <Icon size={11} color={color} strokeWidth={1.5} />
      <Text className="font-sans-medium text-11" style={{ color }}>
        {gateValue(entity, gate)}
      </Text>
    </View>
  );
}

export const EntityCardParts = {
  Root: CardRoot,
  Header: CardHeader,
  Row: CardRow,
  DataItem,
  SourceItem,
};

type EntityCardProps = {
  entity: Entity;
  isSelected?: boolean;
  onPress?: () => void;
};

export function EntityCard({ entity, isSelected, onPress }: EntityCardProps) {
  const name = getEntityName(entity);
  const status = getTrackStatus(entity);
  const time = formatTime(getLastSeen(entity));
  const altitude = formatAltitude(entity.geo?.altitude);
  const course = calculateCourseFromVelocity(entity.kinematics?.velocityEnu);
  const heading = calculateHeadingFromOrientation(entity.orientation);
  const speed = calculateGroundSpeed(entity.kinematics?.velocityEnu);
  const source = entity.controller?.id;
  const blocker = worstBlocker(deriveAssetReadiness(entity));
  const selfGeo = useEntityStore(selectSelfGeo);
  const distance = selfGeo && entity.geo ? geodesicDistance(selfGeo, entity.geo) : undefined;

  return (
    <CardRoot isSelected={isSelected} onPress={onPress}>
      <CardHeader
        title={name}
        right={
          <Badge variant={getStatusBadgeVariant(status)} size="sm">
            {status}
          </Badge>
        }
      />
      <CardRow>
        {blocker && blocker.key !== "device" ? (
          <ReadinessBlockerItem entity={entity} gate={blocker} />
        ) : (
          entity.device && <StatusItem entity={entity} />
        )}
        {heading !== undefined && <DataItem icon={Navigation} value={`${heading.toFixed(0)}°`} />}
        {course !== undefined && <DataItem icon={Compass} value={`${course.toFixed(0)}°`} />}
        <DataItem icon={Mountain} value={altitude} />
        {distance !== undefined && <DataItem icon={Ruler} value={formatDistance(distance)} />}
        {speed !== undefined && <DataItem icon={Zap} value={`${speed.toFixed(0)} m/s`} />}
      </CardRow>
      <CardRow>
        {source && <SourceItem icon={Radio} value={source} />}
        {time && <DataItem icon={Clock} value={time} />}
      </CardRow>
    </CardRoot>
  );
}
