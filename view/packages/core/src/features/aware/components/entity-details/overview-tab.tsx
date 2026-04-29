import { InfoRow } from "@hydris/ui/info-row";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { usePanelContext } from "@hydris/ui/panels";
import { MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import {
  ArrowDown,
  ArrowUp,
  Compass,
  Copy,
  Gauge,
  MapPin,
  Mountain,
  PauseCircle,
  PictureInPicture2,
  Radio,
  RotateCw,
  TrendingUp,
  Video,
  Zap,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { useShallow } from "zustand/react/shallow";

import { formatAltitude, formatTime } from "../../../../lib/api/use-track-utils";
import { toast } from "../../../../lib/sonner";
import { useCameraPaneContext } from "../../camera-pane-context";
import { usePIPContext } from "../../pip-context";
import { useEntityStore } from "../../store/entity-store";
import {
  calculateCourseFromVelocity,
  calculateGroundSpeed,
  calculateVerticalRate,
  formatAcceleration,
  formatAngularRate,
  formatCourse,
  formatSpeed,
  formatVerticalRate,
  hasAngularVelocity,
} from "../../utils/format-kinematics";
import {
  formatMetricValue,
  getMetricLabel,
  getMetricValue,
  getMetricVisual,
  groupMetricsByCategory,
} from "../../utils/format-metrics";
import { resolveStreamUrl } from "../video-stream/resolve-stream-url";
import { VideoStream } from "../video-stream/video-stream";
import { EntityLinkRow } from "./entity-link-row";

const EMPTY_METRICS: never[] = [];

type OverviewTabProps = {
  entity: Entity;
};

function formatCoordinate(value: number, type: "lat" | "lon") {
  const direction = type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(4)}° ${direction}`;
}

type PositionEditorProps = {
  entity: Entity;
};

function PositionEditor({ entity }: PositionEditorProps) {
  const t = useThemeColors();
  if (!entity.geo) return null;

  /* Edit position functionality disabled - can't edit track positions
  const [isEditing, setIsEditing] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [alt, setAlt] = useState("");
  const { updateEntityLocation, isPending } = useEntityMutation();

  const startEditing = () => {
    if (!entity.geo) return;
    setLat(String(entity.geo.latitude));
    setLng(String(entity.geo.longitude));
    setAlt(entity.geo.altitude != null ? String(entity.geo.altitude) : "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveChanges = async () => {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const altitude = parseFloat(alt);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(altitude)) return;

    try {
      await updateEntityLocation(entity, { latitude, longitude, altitude });
      setIsEditing(false);
    } catch {
    }
  };

  const handleTextChange = (value: string, setter: (v: string) => void) => {
    const parsed = parseCoordinates(value);
    if (parsed) {
      setLat(String(parsed.lat));
      setLng(String(parsed.lng));
      if (parsed.alt !== undefined) {
        setAlt(String(parsed.alt));
      }
      return;
    }
    setter(value);
  };

  if (isEditing) {
    return (
      <View className="px-3 pt-3 pb-2">
        <Text className="text-foreground/75 mb-1.5 font-mono text-11 tracking-widest uppercase">
          {entity.geo ? "Edit Position" : "Add Position"}
        </Text>
        <View className="gap-1.5">
          <View className="gap-0.5">
            <Text className="font-sans-medium text-foreground/75 mb-0.5 text-11">Latitude</Text>
            <TextInput
              value={lat}
              onChangeText={(text) => handleTextChange(text, setLat)}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 rounded border px-2 py-1.5 font-mono text-sm focus:outline-none"
              keyboardType="numeric"
              selectTextOnFocus
              placeholderTextColor={t.placeholder}
            />
          </View>
          <View className="gap-0.5">
            <Text className="font-sans-medium text-foreground/75 mb-0.5 text-11">
              Longitude
            </Text>
            <TextInput
              value={lng}
              onChangeText={(text) => handleTextChange(text, setLng)}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 rounded border px-2 py-1.5 font-mono text-sm focus:outline-none"
              keyboardType="numeric"
              selectTextOnFocus
              placeholderTextColor={t.placeholder}
            />
          </View>
          <View className="gap-0.5">
            <Text className="font-sans-medium text-foreground/75 mb-0.5 text-11">
              Altitude (m)
            </Text>
            <TextInput
              value={alt}
              onChangeText={(text) => handleTextChange(text, setAlt)}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 rounded border px-2 py-1.5 font-mono text-sm focus:outline-none"
              keyboardType="numeric"
              selectTextOnFocus
              placeholderTextColor={t.placeholder}
            />
          </View>
        </View>
        <View className="mt-2 flex-row gap-1.5">
          {entity.geo && (
            <Pressable
              onPress={cancelEditing}
              disabled={isPending}
              className="border-foreground/20 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 flex-1 items-center justify-center rounded border py-2.5"
            >
              <Text className="font-sans-medium text-foreground/75 text-xs leading-none">
                Cancel
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={saveChanges}
            disabled={isPending}
            className="bg-green flex-1 items-center justify-center rounded py-2.5 hover:opacity-80 active:opacity-70"
          >
            <Text className="font-sans-medium text-background text-xs leading-none">
              {isPending ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  */

  const coordString = `${formatCoordinate(entity.geo.latitude, "lat")}, ${formatCoordinate(entity.geo.longitude, "lon")}`;

  const copyAllCoords = async () => {
    const coords = `${entity.geo!.latitude.toFixed(6)}, ${entity.geo!.longitude.toFixed(6)}${entity.geo!.altitude != null ? `, ${Math.round(entity.geo!.altitude)}` : ""}`;
    await Clipboard.setStringAsync(coords);
    toast.success("Copied to clipboard");
  };

  return (
    <View className="px-3 pt-3 pb-2">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-foreground/75 text-11 font-mono tracking-widest uppercase">
          Position
        </Text>
        <Pressable
          onPress={copyAllCoords}
          hitSlop={8}
          accessibilityLabel="Copy coordinates"
          accessibilityRole="button"
          className="hover:opacity-70 active:opacity-50"
        >
          <Copy size={12} color={t.iconMuted} strokeWidth={2} />
        </Pressable>
      </View>
      <InfoRow icon={MapPin} label="Coordinates" value={coordString} mono />
      <InfoRow icon={Mountain} label="Altitude" value={formatAltitude(entity.geo.altitude)} mono />
      {/* Edit position functionality disabled can't edit track positions
      <Pressable
        onPress={startEditing}
        className="border-foreground/10 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 mt-1.5 flex-row items-center justify-center gap-1.5 rounded border py-1"
      >
        <Text className="font-sans-medium text-foreground/75 text-xs">Edit</Text>
      </Pressable>
      */}
    </View>
  );
}

function DetectionRow({ detection }: { detection: Entity }) {
  const t = useThemeColors();
  const classification = detection.detection?.classification || "Unknown";
  const azimuth = detection.bearing?.azimuth;
  const time = detection.detection?.lastMeasured;

  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center gap-2">
        <View className="w-5 items-center">
          <Radio size={15} color={t.iconMuted} strokeWidth={2} />
        </View>
        <View>
          <Text className="font-sans-medium text-foreground/75 text-xs">{classification}</Text>
          {time && <Text className="text-foreground/75 text-10 font-mono">{formatTime(time)}</Text>}
        </View>
      </View>
      {azimuth !== undefined && (
        <Text className="text-foreground/90 font-mono text-xs">{azimuth.toFixed(0)}°</Text>
      )}
    </View>
  );
}

function hasEnuData(enu: { east?: number; north?: number; up?: number } | undefined): boolean {
  if (!enu) return false;
  return enu.east !== undefined || enu.north !== undefined || enu.up !== undefined;
}

function KinematicsSection({ entity }: { entity: Entity }) {
  const velocityEnu = entity.kinematics?.velocityEnu;
  const accelerationEnu = entity.kinematics?.accelerationEnu;
  const angularVelocity = entity.kinematics?.angularVelocityBody;
  const courseFromBearing = entity.bearing?.azimuth;

  const groundSpeed = calculateGroundSpeed(velocityEnu);
  const courseFromVelocity = calculateCourseFromVelocity(velocityEnu);
  const verticalRate = calculateVerticalRate(velocityEnu);

  const showVelocityEnu = hasEnuData(velocityEnu);
  const showAcceleration = hasEnuData(accelerationEnu);
  const showAngularVelocity = hasAngularVelocity(angularVelocity);

  if (!entity.kinematics) return null;

  return (
    <>
      <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
        <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
          Velocity
        </Text>
        <InfoRow icon={Zap} label="Ground Speed" value={formatSpeed(groundSpeed)} mono />
        {verticalRate !== undefined && (
          <InfoRow
            icon={verticalRate >= 0 ? ArrowUp : ArrowDown}
            label="Vertical Rate"
            value={formatVerticalRate(verticalRate)}
            mono
          />
        )}
        <InfoRow
          icon={Compass}
          label="Course"
          value={formatCourse(courseFromBearing ?? courseFromVelocity)}
          mono
        />
        {courseFromBearing !== undefined && courseFromVelocity !== undefined && (
          <InfoRow
            icon={Gauge}
            label="Track (velocity)"
            value={formatCourse(courseFromVelocity)}
            mono
          />
        )}
      </View>

      {showVelocityEnu && velocityEnu && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Velocity ENU
          </Text>
          <InfoRow label="East" value={`${velocityEnu.east?.toFixed(2) ?? "—"} m/s`} mono />
          <InfoRow label="North" value={`${velocityEnu.north?.toFixed(2) ?? "—"} m/s`} mono />
          <InfoRow label="Up" value={`${velocityEnu.up?.toFixed(2) ?? "—"} m/s`} mono />
        </View>
      )}

      {showAcceleration && accelerationEnu && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Acceleration
          </Text>
          <InfoRow
            icon={TrendingUp}
            label="Magnitude"
            value={formatAcceleration(accelerationEnu)}
            mono
          />
          <InfoRow label="East" value={`${accelerationEnu.east?.toFixed(2) ?? "—"} m/s²`} mono />
          <InfoRow label="North" value={`${accelerationEnu.north?.toFixed(2) ?? "—"} m/s²`} mono />
          <InfoRow label="Up" value={`${accelerationEnu.up?.toFixed(2) ?? "—"} m/s²`} mono />
        </View>
      )}

      {showAngularVelocity && angularVelocity && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Angular Velocity
          </Text>
          <InfoRow
            icon={RotateCw}
            label="Roll"
            value={formatAngularRate(angularVelocity.rollRate)}
            mono
          />
          <InfoRow label="Pitch" value={formatAngularRate(angularVelocity.pitchRate)} mono />
          <InfoRow label="Yaw" value={formatAngularRate(angularVelocity.yawRate)} mono />
        </View>
      )}
    </>
  );
}

export function OverviewTab({ entity }: OverviewTabProps) {
  const t = useThemeColors();
  const { openPIP, isInPIP } = usePIPContext();
  const cameraPaneContext = useCameraPaneContext();
  const { rightPanelCollapsed } = usePanelContext();
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const liveMetrics = useEntityStore(
    (s) => s.entities.get(entity.id)?.metric?.metrics ?? EMPTY_METRICS,
  );
  const sensorDetections = useEntityStore(
    useShallow((s) => {
      const result: Entity[] = [];
      for (const id of s.detectionEntityIds) {
        const e = s.entities.get(id);
        if (e?.detection?.detectorEntityId === entity.id) result.push(e);
      }
      return result;
    }),
  );

  useAnimatedReaction(
    () => rightPanelCollapsed.value,
    (collapsed, prev) => {
      if (prev !== null && collapsed !== prev) {
        runOnJS(setIsPanelExpanded)(!collapsed);
      }
    },
    [],
  );

  return (
    <ScrollView className="flex-1">
      <View>
        {entity.controller && (
          <View className="px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              Controller
            </Text>
            <InfoRow label="ID" value={entity.controller.id} onCopy />
          </View>
        )}

        <PositionEditor entity={entity} />

        <KinematicsSection entity={entity} />

        {!!(entity.detection?.classification || entity.detection?.detectorEntityId) && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              Detection
            </Text>
            {!!entity.detection?.classification && (
              <InfoRow label="Classification" value={entity.detection.classification} />
            )}
            {!!entity.detection?.detectorEntityId && (
              <EntityLinkRow label="Detected By" entityId={entity.detection.detectorEntityId} />
            )}
          </View>
        )}

        {!!entity.track?.tracker && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              Track
            </Text>
            <EntityLinkRow label="Tracked By" entityId={entity.track.tracker} />
          </View>
        )}

        {sensorDetections.length > 0 && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              Detections ({sensorDetections.length})
            </Text>
            <View>
              {sensorDetections.map((detection) => (
                <DetectionRow key={detection.id} detection={detection} />
              ))}
            </View>
          </View>
        )}

        {liveMetrics.length > 0 &&
          groupMetricsByCategory(liveMetrics).map((group) => (
            <View key={group.category} className="border-foreground/10 border-t px-3 pt-3 pb-2">
              <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
                {group.label}
              </Text>
              {group.metrics.map((metric, i) => {
                if (getMetricVisual(metric) === "gauge") {
                  let value = getMetricValue(metric);
                  if (metric.unit === MetricUnit.MetricUnitRatio) value *= 100;
                  const pct = Math.max(0, Math.min(100, value));
                  return (
                    <View key={metric.id ?? i}>
                      <InfoRow
                        label={getMetricLabel(metric)}
                        value={formatMetricValue(metric)}
                        mono
                      />
                      <View className="bg-foreground/20 h-1 overflow-hidden rounded-full">
                        <View
                          className="bg-foreground/70 h-1 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </View>
                    </View>
                  );
                }
                return (
                  <InfoRow
                    key={metric.id ?? i}
                    label={getMetricLabel(metric)}
                    value={formatMetricValue(metric)}
                    mono
                  />
                );
              })}
            </View>
          ))}

        {entity.camera && entity.camera.streams.length > 0 && (
          <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1.5 font-mono tracking-widest uppercase">
              Video Feeds
            </Text>
            <View className="gap-2">
              {entity.camera.streams.map((stream, index) => {
                const resolved = resolveStreamUrl(stream, entity.id, index);
                const isInPIPWindow = isInPIP(entity.id, resolved.url);
                const isInPane = cameraPaneContext?.isInPane(entity.id) ?? false;
                const isPaused = isInPIPWindow || isInPane;

                return (
                  <View key={stream.url} className="gap-1">
                    <View className="flex-row items-center justify-between">
                      <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                        <Video
                          size={12}
                          color={t.iconSubtle}
                          strokeWidth={1.5}
                          className="shrink-0"
                        />
                        <Text className="text-foreground/75 font-mono text-xs" numberOfLines={1}>
                          {stream.label || `CAM-${index + 1}`}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => openPIP(entity, stream, index)}
                        hitSlop={8}
                        accessibilityLabel="Open in picture-in-picture"
                        accessibilityRole="button"
                        className="active:opacity-50"
                      >
                        <PictureInPicture2 size={12} color={t.iconMuted} strokeWidth={1.5} />
                      </Pressable>
                    </View>
                    <View className="border-foreground/5 bg-background relative aspect-video overflow-hidden rounded border">
                      {isPanelExpanded && !isPaused && (
                        <VideoStream
                          url={resolved.url}
                          protocol={resolved.protocol}
                          objectFit="cover"
                        />
                      )}
                      {isPaused && (
                        <View className="bg-background absolute inset-0 items-center justify-center">
                          <PauseCircle size={24} color={t.iconMuted} strokeWidth={1.5} />
                          <Text className="text-foreground/75 mt-1 font-sans text-xs">
                            {isInPIPWindow ? "Playing in PIP" : "Viewing in Pane"}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
