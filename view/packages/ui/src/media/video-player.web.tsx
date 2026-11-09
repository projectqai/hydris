import { useCallback, useEffect, useRef, useState } from "react";

import { MediaFrame } from "./media-frame";
import type { MediaPlayerProps } from "./types";

export function VideoPlayer({
  url,
  accessibilityLabel = "Video",
  initialPosition = 0,
  playing,
  onTogglePlay,
  onPositionCommit,
  onPlaybackStopped,
  onError,
}: MediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const positionRef = useRef(initialPosition);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isLoaded) return;
    if (playing && video.paused) {
      void video.play().catch(() => onPlaybackStopped(positionRef.current));
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }, [isLoaded, onPlaybackStopped, playing]);

  const handleVideoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) onPositionCommit(positionRef.current);
      videoRef.current = video;
    },
    [onPositionCommit],
  );

  return (
    <div className="w-full">
      <MediaFrame>
        <video
          ref={handleVideoRef}
          aria-label={accessibilityLabel}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            setIsLoaded(true);
            if (initialPosition > 0) video.currentTime = initialPosition;
            positionRef.current = initialPosition;
          }}
          onTimeUpdate={(event) => {
            positionRef.current = event.currentTarget.currentTime;
          }}
          onSeeked={(event) => {
            positionRef.current = event.currentTarget.currentTime;
          }}
          onPlay={() => {
            if (!playing) onTogglePlay();
          }}
          onPause={(event) => {
            positionRef.current = event.currentTarget.currentTime;
            onPositionCommit(positionRef.current);
            if (playing && !event.currentTarget.ended) onTogglePlay();
          }}
          onEnded={(event) => {
            positionRef.current = event.currentTarget.duration;
            onPlaybackStopped(positionRef.current);
          }}
          onError={(event) => {
            console.warn("[media] video playback failed", event.currentTarget.error?.message);
            onError("Unable to play video");
          }}
          style={{ width: "100%", height: "100%" }}
          src={url}
        />
      </MediaFrame>
    </div>
  );
}
