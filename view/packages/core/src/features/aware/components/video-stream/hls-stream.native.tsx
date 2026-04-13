import { useState } from "react";
import { View } from "react-native";
import Video, { type OnVideoErrorData, ResizeMode } from "react-native-video";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState, StreamComponentProps } from "./types";

export function HLSStream({ url, objectFit = "cover" }: StreamComponentProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const handleLoad = () => {
    setConnectionState("connected");
    setError(null);
  };

  const handleError = (e: OnVideoErrorData) => {
    setConnectionState("failed");
    const raw = e.error?.errorString ?? "";
    if (raw.includes("BAD_HTTP_STATUS")) {
      setError("Stream unavailable (server rejected request)");
    } else if (raw.includes("IO_NETWORK") || raw.includes("TIMEOUT")) {
      setError("Network error — check connection");
    } else if (raw.includes("PARSING") || raw.includes("UNSUPPORTED")) {
      setError("Unsupported stream format");
    } else {
      setError("Video playback failed");
    }
  };

  const handleRetry = () => {
    setConnectionState("connecting");
    setError(null);
    setRetryKey((k) => k + 1);
  };

  return (
    <View className="relative h-full w-full bg-black/20">
      <Video
        key={retryKey}
        source={{ uri: url, type: "m3u8" }}
        style={{ width: "100%", height: "100%" }}
        resizeMode={objectFit === "cover" ? ResizeMode.COVER : ResizeMode.CONTAIN}
        onLoad={handleLoad}
        onError={handleError}
        repeat
        muted
      />
      <ConnectionOverlay state={connectionState} error={error} onRetry={handleRetry} />
    </View>
  );
}
