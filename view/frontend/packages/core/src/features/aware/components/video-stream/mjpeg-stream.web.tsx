import { useEffect, useId, useRef, useState } from "react";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState, StreamComponentProps } from "./types";

function appendInstanceParam(url: string, instanceId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("_instance", instanceId);
  return parsed.href;
}

export function MJPEGStream({ url, objectFit = "cover" }: StreamComponentProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const instanceId = useId();
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    img.src = appendInstanceParam(url, instanceId);

    return () => {
      img.src = "";
      img.removeAttribute("src");
    };
  }, [url, instanceId]);

  const handleLoad = () => {
    setConnectionState("connected");
    setError(null);
  };

  const handleError = () => {
    setConnectionState("failed");
    setError("Failed to load MJPEG stream");
  };

  const handleRetry = () => {
    setConnectionState("connecting");
    setError(null);
    if (imgRef.current) {
      imgRef.current.src = appendInstanceParam(url, instanceId);
    }
  };

  return (
    <div className="relative h-full w-full bg-black/20">
      <img
        ref={imgRef}
        alt="MJPEG stream"
        onLoad={handleLoad}
        onError={handleError}
        style={{ width: "100%", height: "100%", objectFit }}
      />
      <ConnectionOverlay state={connectionState} error={error} onRetry={handleRetry} />
    </div>
  );
}
