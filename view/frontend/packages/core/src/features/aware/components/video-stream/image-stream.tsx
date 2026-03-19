import { Image } from "expo-image";
import { RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState, StreamComponentProps } from "./types";

function isValidImageSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:image/") ||
    src.startsWith("/")
  );
}

export function ImageStream({ url, objectFit = "cover" }: StreamComponentProps) {
  const [key, setKey] = useState(() => Date.now());
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    isValidImageSrc(url) ? "connecting" : "failed",
  );
  const [error, setError] = useState<string | null>(
    isValidImageSrc(url) ? null : "Invalid image source",
  );

  return (
    <View className="relative size-full bg-black/20">
      {isValidImageSrc(url) && (
        <Image
          key={key}
          cachePolicy="none"
          source={{ uri: `${url}${url.includes("?") ? "&" : "?"}_t=${key}` }}
          accessibilityLabel="Image stream"
          onLoad={() => {
            setConnectionState("connected");
            setError(null);
          }}
          onError={() => {
            setConnectionState("failed");
            setError("Failed to load image");
          }}
          contentFit={objectFit}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      <ConnectionOverlay
        state={connectionState}
        error={error}
        onRetry={() => {
          if (isValidImageSrc(url)) {
            setConnectionState("connecting");
            setError(null);
            setKey((k) => k + 1);
          }
        }}
      />
      {connectionState === "connected" && (
        <Pressable
          onPress={() => setKey((k) => k + 1)}
          hitSlop={12}
          accessibilityLabel="Refresh image"
          accessibilityRole="button"
          className="absolute right-2 bottom-2 z-10 rounded-full bg-black/50 p-1.5 active:opacity-50"
        >
          <RefreshCw size={14} color="white" />
        </Pressable>
      )}
    </View>
  );
}
