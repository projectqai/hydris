import type { MediaStream as ProtoMediaStream } from "@projectqai/proto/world";
import { MediaStreamProtocol } from "@projectqai/proto/world";

import { baseUrl } from "../../../../lib/api/world-client";
import type { VideoProtocol } from "./types";

export function resolveStreamUrl(
  stream: ProtoMediaStream,
  entityId: string,
  streamIndex: number,
): { url: string; protocol: VideoProtocol } {
  const eid = encodeURIComponent(entityId);
  switch (stream.protocol) {
    case MediaStreamProtocol.MediaStreamProtocolHls:
      return { url: stream.url, protocol: "hls" };
    case MediaStreamProtocol.MediaStreamProtocolIframe:
      return { url: stream.url, protocol: "iframe" };
    case MediaStreamProtocol.MediaStreamProtocolImage:
      return {
        url: `${baseUrl}/media/image/${eid}?stream=${streamIndex}`,
        protocol: "image",
      };
    case MediaStreamProtocol.MediaStreamProtocolMjpeg:
      return {
        url: `${baseUrl}/media/image/${eid}?stream=${streamIndex}`,
        protocol: "mjpeg",
      };
    default:
      return {
        url: `${baseUrl}/media/whep/${eid}?stream=${streamIndex}`,
        protocol: "webrtc",
      };
  }
}
