import { useRef, useState } from "react";

import { ConnectionOverlay } from "./connection-overlay";
import { toEmbedUrl } from "./embed-providers";
import type { ConnectionState, StreamComponentProps } from "./types";

export function IframeStream({ url }: StreamComponentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const embedUrl = toEmbedUrl(url, window.location.hostname);

  const handleLoad = () => {
    setConnectionState("connected");
    setError(null);
  };

  const handleError = () => {
    setConnectionState("failed");
    setError("Failed to load content");
  };

  const handleRetry = () => {
    setConnectionState("connecting");
    setError(null);
    setRetryKey((k) => k + 1);
  };

  return (
    <div className="relative h-full w-full bg-black/20">
      <iframe
        key={retryKey}
        ref={iframeRef}
        src={embedUrl}
        onLoad={handleLoad}
        onError={handleError}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{
          width: "100%",
          height: "100%",
          border: "none",
        }}
      />
      <ConnectionOverlay state={connectionState} error={error} onRetry={handleRetry} />
    </div>
  );
}
