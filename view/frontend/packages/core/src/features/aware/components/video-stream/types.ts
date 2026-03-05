export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export type VideoProtocol = "webrtc" | "hls" | "mjpeg" | "image" | "iframe";

export type VideoStreamProps = {
  url: string;
  protocol: VideoProtocol;
  objectFit?: "contain" | "cover";
};

export type StreamComponentProps = {
  url: string;
  objectFit?: "contain" | "cover";
};
