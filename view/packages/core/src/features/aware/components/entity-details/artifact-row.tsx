import {
  Accordion,
  AccordionContent,
  AccordionIndicator,
  AccordionItem,
  AccordionTrigger,
} from "@hydris/ui/accordion";
import { ControlButton } from "@hydris/ui/controls";
import { Empty, EmptyContent, EmptyMedia, EmptyTitle } from "@hydris/ui/empty-state";
import { InfoRow } from "@hydris/ui/info-row";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { truncateMiddle } from "@hydris/ui/lib/utils";
import { AudioPlayer } from "@hydris/ui/media/audio-player";
import { MediaFrame } from "@hydris/ui/media/media-frame";
import { VideoPlayer } from "@hydris/ui/media/video-player";
import type { Entity } from "@projectqai/proto/world";
import { Image } from "expo-image";
import {
  AlertCircle,
  AudioLines,
  Download,
  FileText,
  Image as ImageIcon,
  Video,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Platform, Text, View } from "react-native";

import { baseUrl } from "../../../../lib/api/world-client";
import { downloadFromEndpoint } from "../../../../lib/download";
import { toast } from "../../../../lib/sonner";
import { formatBytes } from "../../../mission-pack/mission-health-compute";
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./item";

export type ArtifactResolution =
  | { status: "loading" }
  | { status: "failed"; retrying?: boolean; onRetry: () => void };

type ArtifactRowProps = {
  entity: Pick<Entity, "id" | "label" | "artifact">;
  resolution?: ArtifactResolution;
  expanded: boolean;
  playing: boolean;
  initialPosition: number;
  error: string | null;
  onToggleExpanded: (id: string) => void;
  onTogglePlayback: (id: string) => void;
  onPositionCommit: (id: string, position: number) => void;
  onPlaybackStopped: (id: string, position: number) => void;
  onError: (id: string, error: string) => void;
  onClearError: (id: string) => void;
};

export function ArtifactRow({
  entity,
  resolution,
  expanded,
  playing,
  initialPosition,
  error,
  onToggleExpanded,
  onTogglePlayback,
  onPositionCommit,
  onPlaybackStopped,
  onError,
  onClearError,
}: ArtifactRowProps) {
  const t = useThemeColors();
  const artifact = entity.artifact;
  const [retryKey, setRetryKey] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const togglePlayback = useCallback(
    () => onTogglePlayback(entity.id),
    [entity.id, onTogglePlayback],
  );
  const handlePositionCommit = useCallback(
    (position: number) => onPositionCommit(entity.id, position),
    [entity.id, onPositionCommit],
  );
  const handlePlaybackStopped = useCallback(
    (position: number) => onPlaybackStopped(entity.id, position),
    [entity.id, onPlaybackStopped],
  );
  const handleError = useCallback(
    (message: string) => onError(entity.id, message),
    [entity.id, onError],
  );
  const handleLoad = useCallback(() => onClearError(entity.id), [entity.id, onClearError]);
  const handleRetry = useCallback(() => {
    onClearError(entity.id);
    setRetryKey((key) => key + 1);
  }, [entity.id, onClearError]);
  const handleAudioRetry = useCallback(() => {
    onClearError(entity.id);
    setRetryKey((key) => key + 1);
    onTogglePlayback(entity.id);
  }, [entity.id, onClearError, onTogglePlayback]);

  const contentType = artifact?.contentType ?? "";
  const name = entity.label || entity.id;
  const size = artifact?.sizeBytes === undefined ? null : formatBytes(Number(artifact.sizeBytes));
  const metadata =
    resolution?.status === "loading" ? "Loading…" : [contentType, size].filter(Boolean).join(" · ");
  const url = `${baseUrl}/artifacts/${encodeURIComponent(entity.id)}`;
  const loadUrl = retryKey === 0 ? url : `${url}?_t=${retryKey}`;
  const isAudio = contentType.startsWith("audio/");
  const isImage = contentType.startsWith("image/");
  const isVideo = contentType.startsWith("video/");
  const KindIcon = isImage ? ImageIcon : isVideo ? Video : isAudio ? AudioLines : FileText;
  const missingContentType = artifact !== undefined && contentType.length === 0;
  const loadError =
    resolution?.status === "failed"
      ? "Artifact could not be loaded"
      : (error ?? (missingContentType ? "Artifact content type is missing" : null));
  const failed = loadError !== null;
  const downloadArtifact = async () => {
    if (!artifact) return;
    setDownloading(true);
    try {
      await downloadFromEndpoint({
        url,
        method: "GET",
        mimeType: contentType,
        parentFolder: "Hydris-Artifacts",
        fallbackFilename: entity.id,
      });
      toast.info(
        Platform.OS === "web" ? "Sent to downloads" : "Saved to Downloads/Hydris-Artifacts",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const retrying = resolution?.status === "failed" && resolution.retrying === true;
  const failureAction =
    resolution?.status === "failed"
      ? { label: "Retry", onPress: resolution.onRetry }
      : !artifact || missingContentType
        ? undefined
        : {
            label: "Retry",
            onPress: isAudio ? handleAudioRetry : handleRetry,
          };

  return (
    <Accordion
      type="multiple"
      value={expanded ? [entity.id] : []}
      onValueChange={() => onToggleExpanded(entity.id)}
      className="mb-2"
    >
      <AccordionItem value={entity.id}>
        <AccordionTrigger
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${name}${failed ? ", load failed" : ""}`}
        >
          <ItemMedia>
            {failed ? (
              <AlertCircle aria-hidden size={16} strokeWidth={2} color={t.iconMuted} />
            ) : (
              <KindIcon aria-hidden size={16} strokeWidth={2} color={t.iconSubtle} />
            )}
          </ItemMedia>

          <ItemContent>
            <ItemTitle>{name}</ItemTitle>
            <ItemDescription>{metadata}</ItemDescription>
          </ItemContent>
          <AccordionIndicator />
        </AccordionTrigger>

        <AccordionContent className="px-0 pb-0">
          {resolution?.status === "loading" ? (
            <Empty variant="small">
              <EmptyTitle>Loading artifact…</EmptyTitle>
            </Empty>
          ) : loadError ? (
            <Empty variant="small">
              <EmptyMedia icon={AlertCircle} color={t.redForeground} />
              <EmptyTitle className="text-red-foreground">{loadError}</EmptyTitle>
              {failureAction && (
                <EmptyContent>
                  <ControlButton
                    label={failureAction.label}
                    size="sm"
                    loading={retrying}
                    disabled={retrying}
                    accessibilityLabel={failureAction.label}
                    onPress={failureAction.onPress}
                  />
                </EmptyContent>
              )}
            </Empty>
          ) : isImage ? (
            <MediaFrame>
              <Image
                key={retryKey}
                source={{ uri: loadUrl }}
                accessibilityLabel={name}
                contentFit="contain"
                onLoad={handleLoad}
                onError={() => handleError("Failed to load image")}
                style={{ width: "100%", height: "100%" }}
              />
            </MediaFrame>
          ) : isAudio ? (
            <AudioPlayer
              url={loadUrl}
              accessibilityLabel={name}
              initialPosition={initialPosition}
              playing={playing}
              onTogglePlay={togglePlayback}
              onPositionCommit={handlePositionCommit}
              onPlaybackStopped={handlePlaybackStopped}
              onLoad={handleLoad}
              onError={handleError}
            />
          ) : isVideo ? (
            <VideoPlayer
              key={retryKey}
              url={loadUrl}
              accessibilityLabel={name}
              initialPosition={initialPosition}
              playing={playing}
              onTogglePlay={togglePlayback}
              onPositionCommit={handlePositionCommit}
              onPlaybackStopped={handlePlaybackStopped}
              onError={handleError}
            />
          ) : null}

          {artifact?.sha256 ? (
            <InfoRow
              label="SHA-256"
              value={
                <Text accessibilityLabel={artifact.sha256}>
                  {truncateMiddle(artifact.sha256, 10)}
                </Text>
              }
              copyValue={artifact.sha256}
              onCopy
              mono
              className={
                loadError || isImage || isAudio || isVideo
                  ? "border-foreground/8 border-t px-2.5"
                  : "px-2.5"
              }
            />
          ) : null}

          {artifact ? (
            <View className="px-2.5 pt-1 pb-3">
              <ControlButton
                icon={Download}
                label={downloading ? "Downloading…" : "Download"}
                size="md"
                fullWidth
                disabled={downloading}
                loading={downloading}
                labelClassName="text-xs leading-none"
                accessibilityLabel="Download artifact"
                onPress={() => void downloadArtifact()}
              />
            </View>
          ) : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
