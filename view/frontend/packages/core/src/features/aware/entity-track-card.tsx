import { Badge } from "@hydris/ui/badge";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { Clock, Compass, Mountain, Radio, Zap } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Pressable, Text, View } from "react-native";

import {
  formatAltitude,
  formatTime,
  getEntityName,
  getStatusBadgeVariant,
  getTrackStatus,
} from "../../lib/api/use-track-utils";
import { calculateCourseFromVelocity, calculateGroundSpeed } from "./utils/format-kinematics";

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

type EntityCardProps = {
  entity: Entity;
  isSelected?: boolean;
  onPress?: () => void;
};

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

export function EntityCard({ entity, isSelected, onPress }: EntityCardProps) {
  const t = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isLight = colorScheme === "light";
  const name = getEntityName(entity);
  const status = getTrackStatus(entity);
  const time = formatTime(entity.lifetime?.from || entity.detection?.lastMeasured);
  const altitude = formatAltitude(entity.geo?.altitude);
  const course =
    entity.bearing?.azimuth ?? calculateCourseFromVelocity(entity.kinematics?.velocityEnu);
  const speed = calculateGroundSpeed(entity.kinematics?.velocityEnu);
  const source = entity.controller?.id;

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
      <View className="mb-1.5 flex-row items-center justify-between gap-2">
        <Text className="font-sans-semibold text-foreground text-13 flex-1" numberOfLines={1}>
          {name}
        </Text>
        <Badge variant={getStatusBadgeVariant(status)} size="sm">
          {status}
        </Badge>
      </View>
      <View className="mb-1 flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
        {course !== undefined && <DataItem icon={Compass} value={`${course.toFixed(0)}°`} />}
        <DataItem icon={Mountain} value={altitude} />
        {speed !== undefined && <DataItem icon={Zap} value={`${speed.toFixed(0)} m/s`} />}
      </View>
      <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
        {source && <SourceItem icon={Radio} value={source} />}
        {time && <DataItem icon={Clock} value={time} />}
      </View>
    </Pressable>
  );
}
