type MediaPlaybackStatus = {
  playing: boolean;
  position: number;
  duration: number;
};

export type MediaPlayerProps = {
  url: string;
  accessibilityLabel?: string;
  initialPosition?: number;
  playing: boolean;
  onTogglePlay: () => void;
  onPositionCommit: (position: number) => void;
  onPlaybackStopped: (position: number) => void;
  onLoad?: () => void;
  onError: (error: string) => void;
};

type MediaTransportBaseProps = MediaPlaybackStatus & {
  isLoaded: boolean;
  onTogglePlay: () => void;
};

export type MediaTransportProps = MediaTransportBaseProps &
  (
    | {
        seekable: true;
        onSeek: (seconds: number) => void;
        onSeekStart: () => void;
        onSeekEnd: () => void;
      }
    | {
        seekable: false;
        onSeek?: never;
        onSeekStart?: never;
        onSeekEnd?: never;
      }
  );
