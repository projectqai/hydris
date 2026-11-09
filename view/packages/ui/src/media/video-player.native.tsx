import { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import Video, { ResizeMode, type VideoRef } from "react-native-video";

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
  const videoRef = useRef<VideoRef>(null);
  const positionRef = useRef(initialPosition);
  const durationRef = useRef(0);
  const wasPlaying = useRef(false);
  const isBuffering = useRef(false);

  const handleVideoRef = useCallback(
    (video: VideoRef | null) => {
      if (!video) onPositionCommit(positionRef.current);
      videoRef.current = video;
    },
    [onPositionCommit],
  );

  useEffect(() => {
    if (playing || !wasPlaying.current) return;
    wasPlaying.current = false;
    onPositionCommit(positionRef.current);
  }, [onPositionCommit, playing]);

  return (
    <View className="w-full">
      <MediaFrame>
        <Video
          ref={handleVideoRef}
          source={{ uri: url }}
          style={{ width: "100%", height: "100%" }}
          resizeMode={ResizeMode.CONTAIN}
          controls={true}
          paused={!playing}
          onProgress={(event) => {
            positionRef.current = event.currentTime;
          }}
          onSeek={(event) => {
            positionRef.current = event.currentTime;
          }}
          onLoad={(event) => {
            durationRef.current = event.duration;
            if (initialPosition > 0) videoRef.current?.seek(initialPosition);
            positionRef.current = initialPosition;
          }}
          onBuffer={(event) => {
            isBuffering.current = event.isBuffering;
          }}
          onPlaybackStateChanged={(event) => {
            if (event.isSeeking || isBuffering.current || event.isPlaying === wasPlaying.current) {
              return;
            }
            wasPlaying.current = event.isPlaying;
            if (!event.isPlaying) onPositionCommit(positionRef.current);
            if (event.isPlaying !== playing) onTogglePlay();
          }}
          onEnd={() => {
            wasPlaying.current = false;
            positionRef.current = durationRef.current;
            onPlaybackStopped(durationRef.current);
          }}
          onError={(event) => {
            console.warn("[media] video playback failed", event.error.errorString);
            onError("Unable to play video");
          }}
          accessibilityLabel={accessibilityLabel}
        />
      </MediaFrame>
    </View>
  );
}
