import type { MediaStream as ProtoMediaStream } from "@projectqai/proto/world";
import { MediaStreamProtocol } from "@projectqai/proto/world";

import { baseUrl } from "../../../../lib/api/world-client";
import type { VideoProtocol } from "./types";

function toVideoProtocol(proto: MediaStreamProtocol): VideoProtocol | null {
  switch (proto) {
    case MediaStreamProtocol.MediaStreamProtocolHls:
      return "hls";
    case MediaStreamProtocol.MediaStreamProtocolMjpeg:
      return "mjpeg";
    case MediaStreamProtocol.MediaStreamProtocolImage:
      return "image";
    case MediaStreamProtocol.MediaStreamProtocolIframe:
      return "iframe";
    case MediaStreamProtocol.MediaStreamProtocolWebrtc:
      return "webrtc";
    default:
      return null;
  }
}

// When the frontend can't play a protocol directly (e.g. rtsp://),
// request a WHEP stream from the backend which transcodes to WebRTC.
export function resolveStreamUrl(
  stream: ProtoMediaStream,
  entityId: string,
  streamIndex: number,
): { url: string; protocol: VideoProtocol } {
  const protocol = toVideoProtocol(stream.protocol);
  if (protocol) return { url: stream.url, protocol };
  return {
    url: `${baseUrl}/media/whep/${encodeURIComponent(entityId)}/${streamIndex}`,
    protocol: "webrtc",
  };
}
