import { InfoRow } from "@hydris/ui/info-row";
import { SEVERITY_DOT } from "@hydris/ui/lib/severity";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { MiddleTruncateText } from "@hydris/ui/middle-truncate-text";
import { usePanelContext } from "@hydris/ui/panels";
import { Progress, ProgressIndicator, ProgressTrack } from "@hydris/ui/progress";
import { MetricUnit } from "@projectqai/proto/metrics";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import {
  ArrowDown,
  ArrowUp,
  Compass,
  Copy,
  MapPin,
  Mountain,
  PictureInPicture2,
  Radio,
  RotateCw,
  TrendingUp,
  Zap,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { useShallow } from "zustand/react/shallow";

import {
  formatAltitude,
  formatTime,
  getDetectionLabel,
  getLastSeen,
  getTaxonomyEntries,
} from "../../../../lib/api/use-track-utils";
import { toast } from "../../../../lib/sonner";
import { type EvidenceEntry, useEvidence } from "../../hooks/use-evidence";
import { usePIPContext } from "../../pip-context";
import { selectDetectionsByDetector, useEntityStore } from "../../store/entity-store";
import { focusEntity } from "../../utils/focus-entity";
import { formatMetricAlert } from "../../utils/format-entity";
import {
  calculateCourseFromVelocity,
  calculateGroundSpeed,
  calculateHeadingFromOrientation,
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
import { VideoFeed, VideoFeedLabel } from "../video-stream/video-feed";
import { type ArtifactResolution, ArtifactRow } from "./artifact-row";
import { ClassificationRow } from "./classification-row";
import { EntityLinkRow } from "./entity-link-row";
import { EvidenceLinkRow } from "./evidence-link-row";
import { LinkRow } from "./link-row";

const EMPTY_METRICS: never[] = [];

type OverviewTabProps = {
  entity: Entity;
};

function formatCoordinate(value: number, type: "lat" | "lon") {
  const [positive, negative] = type === "lat" ? ["N", "S"] : ["E", "W"];
  const direction = value >= 0 ? positive : negative;

  return `${Math.abs(value).toFixed(4)}° ${direction}`;
}

type PositionSectionProps = {
  entity: Entity;
};

function PositionSection({ entity }: PositionSectionProps) {
  const t = useThemeColors();
  if (!entity.geo) return null;

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
      {entity.orientation && (
        <InfoRow
          icon={RotateCw}
          label="Heading"
          value={formatCourse(calculateHeadingFromOrientation(entity.orientation))}
          mono
        />
      )}
    </View>
  );
}

function ExternalLinkRow({ label, url }: { label: string; url: string }) {
  const handlePress = () => {
    void Linking.openURL(url).catch(() => {
      toast.error("Failed to open link");
    });
  };

  return (
    <LinkRow label={label} value={url} onPress={handlePress} accessibilityLabel={`Open ${url}`} />
  );
}

function DetectionRow({ detection }: { detection: Entity }) {
  const t = useThemeColors();
  const label = getDetectionLabel(detection);
  const classification = label?.text || detection.detection?.classification || "Unknown";
  const labelClassName = "font-sans-medium text-foreground/75 text-xs underline";
  const azimuth = detection.bearing?.azimuth;
  const time = getLastSeen(detection);

  return (
    <Pressable
      onPress={() => focusEntity(detection.id)}
      accessibilityRole="link"
      accessibilityLabel={`Navigate to ${classification}`}
      hitSlop={4}
      className="flex-row items-center justify-between gap-2 py-1.5 hover:opacity-70 active:opacity-50"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <View className="w-5 items-center">
          <Radio size={15} color={t.iconMuted} strokeWidth={2} />
        </View>
        <View className="min-w-0 flex-1">
          {label ? (
            <MiddleTruncateText
              text={label.text}
              tailLength={label.tailLength}
              className={labelClassName}
            />
          ) : (
            <Text numberOfLines={1} className={labelClassName}>
              {classification}
            </Text>
          )}
          {time && <Text className="text-foreground/75 text-10 font-mono">{formatTime(time)}</Text>}
        </View>
      </View>
      {azimuth !== undefined && (
        <Text className="text-foreground/90 font-mono text-xs">{azimuth.toFixed(0)}°</Text>
      )}
    </Pressable>
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

  const groundSpeed = calculateGroundSpeed(velocityEnu);
  const course = calculateCourseFromVelocity(velocityEnu);
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
        <InfoRow icon={Compass} label="Course" value={formatCourse(course)} mono />
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

function useArtifactRows() {
  const [{ closedIds, playingId }, setPlaybackState] = useState<{
    closedIds: Set<string>;
    playingId: string | null;
  }>(() => ({ closedIds: new Set(), playingId: null }));
  const [positionById, setPositionById] = useState<Record<string, number>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const handleToggleExpanded = useCallback((id: string) => {
    setPlaybackState((current) => {
      const closing = !current.closedIds.has(id);
      const closedIds = new Set(current.closedIds);

      if (closing) closedIds.add(id);
      else closedIds.delete(id);
      return {
        closedIds,
        playingId: closing && current.playingId === id ? null : current.playingId,
      };
    });
  }, []);

  const handleTogglePlayback = useCallback((id: string) => {
    setPlaybackState((current) => ({
      ...current,
      playingId: current.playingId === id ? null : id,
    }));
  }, []);

  const handlePositionCommit = useCallback((id: string, position: number) => {
    setPositionById((current) =>
      current[id] === position ? current : { ...current, [id]: position },
    );
  }, []);

  const handlePlaybackStopped = useCallback((id: string, position: number) => {
    setPositionById((current) =>
      current[id] === position ? current : { ...current, [id]: position },
    );
    setPlaybackState((current) =>
      current.playingId === id ? { ...current, playingId: null } : current,
    );
  }, []);

  const handleArtifactError = useCallback((id: string, error: string) => {
    setErrorById((current) => (current[id] === error ? current : { ...current, [id]: error }));
    setPlaybackState((current) =>
      current.playingId === id ? { ...current, playingId: null } : current,
    );
  }, []);

  const handleClearArtifactError = useCallback((id: string) => {
    setErrorById((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return (id: string) => ({
    expanded: !closedIds.has(id),
    playing: playingId === id,
    initialPosition: positionById[id] ?? 0,
    error: errorById[id] ?? null,
    onToggleExpanded: handleToggleExpanded,
    onTogglePlayback: handleTogglePlayback,
    onPositionCommit: handlePositionCommit,
    onPlaybackStopped: handlePlaybackStopped,
    onError: handleArtifactError,
    onClearError: handleClearArtifactError,
  });
}

function evidenceResolution(
  item: EvidenceEntry,
  retry: (id: string) => void,
): ArtifactResolution | undefined {
  if (item.status === "loading") return { status: "loading" };

  if (item.status === "failed") {
    return { status: "failed", retrying: item.retrying, onRetry: () => retry(item.id) };
  }

  return undefined;
}

function ArtifactSections({ entity }: { entity: Entity }) {
  const { entries, retry } = useEvidence(entity);
  const rowState = useArtifactRows();
  const ownArtifact = !!entity.artifact;
  const evidence = ownArtifact ? entries.filter((item) => item.id !== entity.id) : entries;
  const hasEvidence = !!(evidence.length || entity.interactivity?.referenceUrl);

  return (
    <>
      {ownArtifact && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Artifact
          </Text>
          <View className="mt-2.5">
            <ArtifactRow entity={entity} {...rowState(entity.id)} />
          </View>
        </View>
      )}

      {hasEvidence && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <View className="mb-1 flex-row items-center gap-2">
            <Text
              className="text-foreground/75 text-11 min-w-0 font-mono tracking-widest uppercase"
              numberOfLines={1}
            >
              Evidence
            </Text>
            <View className="bg-surface-overlay/10 h-5 shrink-0 items-center justify-center rounded px-1.5">
              <Text
                className="text-on-surface/85 text-11 font-mono leading-none tabular-nums"
                numberOfLines={1}
              >
                {evidence.length}
              </Text>
            </View>
          </View>
          {evidence.length > 0 ? (
            <View className="mt-2.5">
              {evidence.map((item) => {
                if (item.status === "resolved" && !item.entity.artifact) {
                  return <EvidenceLinkRow key={item.id} entity={item.entity} />;
                }

                return (
                  <ArtifactRow
                    key={item.id}
                    entity={item.status === "resolved" ? item.entity : { id: item.id }}
                    resolution={evidenceResolution(item, retry)}
                    {...rowState(item.id)}
                  />
                );
              })}
            </View>
          ) : null}
          {!!entity.interactivity?.referenceUrl && (
            <ExternalLinkRow label="Reference" url={entity.interactivity.referenceUrl} />
          )}
        </View>
      )}
    </>
  );
}

export function OverviewTab({ entity }: OverviewTabProps) {
  const t = useThemeColors();
  const { openPIP } = usePIPContext();
  const { rightPanelCollapsed } = usePanelContext();
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const liveMetrics = useEntityStore(
    (s) => s.entities.get(entity.id)?.metric?.metrics ?? EMPTY_METRICS,
  );
  const sensorDetections = useEntityStore(useShallow(selectDetectionsByDetector(entity.id)));
  const taxonomy = entity.detection ? getTaxonomyEntries(entity) : [];

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
    <View>
      {!!entity.controller?.id && (
        <View className="px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Controller
          </Text>
          <InfoRow label="ID" value={entity.controller.id} onCopy />
        </View>
      )}

      <PositionSection entity={entity} />

      <KinematicsSection entity={entity} />

      {(taxonomy.length > 0 ||
        !!entity.detection?.classification ||
        !!entity.detection?.detectorEntityId) && (
        <View className="border-foreground/10 border-t px-3 pt-3 pb-2">
          <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
            Detection
          </Text>
          <ClassificationRow entries={taxonomy} fallback={entity.detection?.classification} />
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

      <ArtifactSections key={entity.id} entity={entity} />

      {liveMetrics.length > 0 &&
        groupMetricsByCategory(liveMetrics).map((group) => (
          <View key={group.category} className="border-foreground/10 border-t px-3 pt-3 pb-2">
            <Text className="text-foreground/75 text-11 mb-1 font-mono tracking-widest uppercase">
              {group.label}
            </Text>
            {group.metrics.map((metric, i) => {
              const alert = formatMetricAlert(metric.alerting);

              const value = alert ? (
                <Text className={alert.className}>
                  <Text className="text-10 tracking-wide uppercase">{alert.label}</Text>
                  {"  "}
                  {formatMetricValue(metric)}
                </Text>
              ) : (
                formatMetricValue(metric)
              );

              if (getMetricVisual(metric) === "gauge") {
                let gaugeValue = getMetricValue(metric);

                if (metric.unit === MetricUnit.MetricUnitRatio) gaugeValue *= 100;

                return (
                  <View key={metric.id ?? i}>
                    <InfoRow label={getMetricLabel(metric)} value={value} mono />
                    <Progress value={gaugeValue} accessibilityLabel={getMetricLabel(metric)}>
                      <ProgressTrack>
                        <ProgressIndicator
                          className={alert ? SEVERITY_DOT[alert.severity] : undefined}
                        />
                      </ProgressTrack>
                    </Progress>
                  </View>
                );
              }

              return (
                <InfoRow key={metric.id ?? i} label={getMetricLabel(metric)} value={value} mono />
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
            {entity.camera.streams.map((stream, index) => (
              <View key={stream.url} className="gap-1">
                <View className="flex-row items-center justify-between">
                  <VideoFeedLabel stream={stream} index={index} />
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
                <VideoFeed
                  entityId={entity.id}
                  stream={stream}
                  index={index}
                  objectFit="cover"
                  enabled={isPanelExpanded}
                  className="aspect-video"
                />
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
