import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { MediaTransport } from "./media-transport";
import type { MediaPlayerProps } from "./types";

export function AudioPlayer({
  url,
  accessibilityLabel = "Audio",
  initialPosition = 0,
  playing,
  onTogglePlay,
  onPositionCommit,
  onPlaybackStopped,
  onLoad,
  onError,
}: MediaPlayerProps) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const isSeeking = useRef(false);
  const pendingSeekCount = useRef(0);
  const positionRef = useRef(initialPosition);
  const wasPlaying = useRef(false);
  const reportedEnd = useRef(false);
  const startedBuffering = useRef(false);
  const [position, setPosition] = useState(initialPosition);
  const [initialized, setInitialized] = useState(false);
  const [isSeekPending, setIsSeekPending] = useState(false);

  useEffect(() => {
    if (status.error) {
      console.warn("[media] audio playback failed", status.error);
      onError("Unable to play audio");
      return;
    }
    if (status.isBuffering) startedBuffering.current = true;
    if (!status.isLoaded) {
      // Android reports an unreachable source by falling back to idle without
      // ever setting error, so a row would otherwise wait for a load forever.
      if (startedBuffering.current && status.playbackState === "idle") {
        onError("Unable to play audio");
      }
      return;
    }

    if (status.didJustFinish) {
      isSeeking.current = false;
      positionRef.current = status.duration;
      setPosition(status.duration);
    } else if (!isSeeking.current) {
      positionRef.current = status.currentTime;
      setPosition(status.currentTime);
    }

    if (wasPlaying.current && !status.playing) onPositionCommit(positionRef.current);
    wasPlaying.current = status.playing;

    if (status.didJustFinish && !reportedEnd.current) {
      reportedEnd.current = true;
      onPlaybackStopped(status.duration);
    } else if (!status.didJustFinish) {
      reportedEnd.current = false;
    }
  }, [status, onError, onPlaybackStopped, onPositionCommit]);

  useEffect(() => {
    if (status.isLoaded && status.duration > 0) onLoad?.();
  }, [onLoad, status.duration, status.isLoaded]);

  useEffect(() => {
    if (!status.isLoaded || initialized) return;
    if (initialPosition <= 0) {
      setInitialized(true);
      return;
    }

    let cancelled = false;
    void player.seekTo(initialPosition).then(() => {
      if (!cancelled) setInitialized(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialPosition, initialized, player, status.isLoaded]);

  useEffect(() => {
    if (!initialized) return;
    if (playing && !status.playing && !status.didJustFinish) player.play();
    else if (!playing && status.playing) player.pause();
  }, [initialized, player, playing, status.didJustFinish, status.playing]);

  const commitRef = useRef(onPositionCommit);
  useEffect(() => {
    commitRef.current = onPositionCommit;
  });
  useEffect(() => () => commitRef.current(positionRef.current), []);

  const handleSeek = useCallback(
    (seconds: number) => {
      positionRef.current = seconds;
      setPosition(seconds);
      pendingSeekCount.current += 1;
      setIsSeekPending(true);
      void player.seekTo(seconds).finally(() => {
        pendingSeekCount.current -= 1;
        if (pendingSeekCount.current === 0) setIsSeekPending(false);
      });
    },
    [player],
  );

  return (
    <View accessibilityLabel={accessibilityLabel}>
      <MediaTransport
        playing={isSeekPending ? playing : status.playing}
        position={position}
        duration={status.duration}
        isLoaded={initialized}
        seekable
        onTogglePlay={() => {
          if (status.didJustFinish) {
            positionRef.current = 0;
            setPosition(0);
            void player.seekTo(0).then(onTogglePlay);
          } else {
            onTogglePlay();
          }
        }}
        onSeek={handleSeek}
        onSeekStart={() => {
          isSeeking.current = true;
        }}
        onSeekEnd={() => {
          isSeeking.current = false;
        }}
      />
    </View>
  );
}
