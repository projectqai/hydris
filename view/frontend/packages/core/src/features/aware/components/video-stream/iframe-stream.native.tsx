import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { ConnectionOverlay } from "./connection-overlay";
import { toEmbedUrl } from "./embed-providers";
import type { ConnectionState, StreamComponentProps } from "./types";

export function IframeStream({ url }: StreamComponentProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const embedUrl = toEmbedUrl(url);

  const handleRetry = () => {
    setConnectionState("connecting");
    setError(null);
    setRetryKey((k) => k + 1);
  };

  return (
    <View className="relative h-full w-full bg-black/20">
      <WebView
        key={retryKey}
        source={{ uri: embedUrl }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onLoad={() => setConnectionState("connected")}
        onError={(e) => {
          setConnectionState("failed");
          setError(e.nativeEvent.description || "Failed to load content");
        }}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
      <ConnectionOverlay state={connectionState} error={error} onRetry={handleRetry} />
    </View>
  );
}
