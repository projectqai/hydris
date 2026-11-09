import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { MediaStream } from "@projectqai/proto/world";
import { PauseCircle, Video } from "lucide-react-native";
import { Text, View } from "react-native";

import { useCameraPaneContext } from "../../camera-pane-context";
import { usePIPContext } from "../../pip-context";
import type { StreamStatus } from "./connection-overlay";
import { StreamPreviewContext } from "./connection-overlay";
import { resolveStreamUrl } from "./resolve-stream-url";
import { VideoStream } from "./video-stream";

type FeedProps = { entityId: string; stream: MediaStream; index: number };

export function getStreamLabel(stream: MediaStream, index: number): string {
  return stream.label || `CAM-${index + 1}`;
}

export function VideoFeedLabel({ stream, index }: Omit<FeedProps, "entityId">) {
  const t = useThemeColors();

  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
      <Video size={12} color={t.iconSubtle} strokeWidth={1.5} className="shrink-0" />
      <Text className="text-foreground/75 shrink font-mono text-xs">
        {getStreamLabel(stream, index)}
      </Text>
    </View>
  );
}

export function VideoFeed({
  entityId,
  stream,
  index,
  objectFit,
  enabled,
  cameraEntityId,
  onPreviewStatus,
  className,
}: FeedProps & {
  objectFit: "contain" | "cover";
  enabled: boolean;
  cameraEntityId?: string;
  // makes the feed a preview: no player overlay or controls, the caller draws the status
  onPreviewStatus?: (status: StreamStatus | null) => void;
  className?: string;
}) {
  const t = useThemeColors();
  const { isInPIP } = usePIPContext();
  const cameraPaneContext = useCameraPaneContext();
  const resolved = resolveStreamUrl(stream, entityId, index);
  const isInPIPWindow = isInPIP(entityId, resolved.url);
  const isInPane = cameraPaneContext?.isInPane(entityId) ?? false;
  const isPaused = isInPIPWindow || isInPane;

  return (
    <View
      className={cn(
        "border-foreground/5 bg-background relative overflow-hidden rounded border",
        className,
      )}
    >
      {enabled && !isPaused && (
        <StreamPreviewContext value={onPreviewStatus ?? null}>
          <VideoStream
            url={resolved.url}
            protocol={resolved.protocol}
            objectFit={objectFit}
            cameraEntityId={cameraEntityId}
          />
        </StreamPreviewContext>
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
  );
}
