import { View } from "react-native";

import { DetectionOverlay } from "./detection-overlay";
import { HLSStream } from "./hls-stream";
import { IframeStream } from "./iframe-stream";
import { ImageStream } from "./image-stream";
import { MJPEGStream } from "./mjpeg-stream";
import type { VideoStreamProps } from "./types";
import { WebRTCStream } from "./webrtc-stream";

function StreamContent({ url, protocol, objectFit }: VideoStreamProps) {
  switch (protocol) {
    case "hls":
      return <HLSStream url={url} objectFit={objectFit} />;
    case "mjpeg":
      return <MJPEGStream url={url} objectFit={objectFit} />;
    case "image":
      return <ImageStream url={url} objectFit={objectFit} />;
    case "iframe":
      return <IframeStream url={url} objectFit={objectFit} />;
    case "webrtc":
    default:
      return <WebRTCStream url={url} objectFit={objectFit} />;
  }
}

export function VideoStream({
  url,
  protocol,
  objectFit = "cover",
  cameraEntityId,
}: VideoStreamProps) {
  if (!cameraEntityId) {
    return <StreamContent url={url} protocol={protocol} objectFit={objectFit} />;
  }

  return (
    <View className="relative h-full w-full">
      <StreamContent url={url} protocol={protocol} objectFit={objectFit} />
      <DetectionOverlay cameraEntityId={cameraEntityId} objectFit={objectFit} />
    </View>
  );
}
