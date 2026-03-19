import { Badge } from "@hydris/ui/badge";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { Clock, Compass, Mountain, Radio, Ruler, Zap } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import {
  formatAltitude,
  formatTime,
  getEntityName,
  getStatusBadgeVariant,
  getTrackStatus,
} from "../../lib/api/use-track-utils";
import { selectSelfGeo, useEntityStore } from "./store/entity-store";
import {
  calculateCourseFromVelocity,
  calculateGroundSpeed,
  formatDistance,
  haversineDistance,
} from "./utils/format-kinematics";

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
    >
      {children}
    </Pressable>
  );
}

type CardHeaderProps = {
  title: string;
  right?: ReactNode;
};

function CardHeader({ title, right }: CardHeaderProps) {
  return (
    <View className="mb-1.5 flex-row items-center justify-between gap-2">
      <Text className="font-sans-semibold text-foreground text-13 flex-1" numberOfLines={1}>
        {title}
      </Text>
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
  const time = formatTime(entity.lifetime?.from || entity.detection?.lastMeasured);
  const altitude = formatAltitude(entity.geo?.altitude);
  const course =
    entity.bearing?.azimuth ?? calculateCourseFromVelocity(entity.kinematics?.velocityEnu);
  const speed = calculateGroundSpeed(entity.kinematics?.velocityEnu);
  const source = entity.controller?.id;
  const selfGeo = useEntityStore(selectSelfGeo);
  const distance = selfGeo && entity.geo ? haversineDistance(selfGeo, entity.geo) : undefined;

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
