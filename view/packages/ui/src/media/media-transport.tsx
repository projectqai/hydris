import { Pause, Play } from "lucide-react-native";
import { Text, View } from "react-native";

import { ControlIconButton } from "../controls/control-button";
import { formatMinutesSeconds } from "../lib/utils";
import { Scrubber } from "./scrubber";
import type { MediaTransportProps } from "./types";

const EMPTY_CALLBACK = () => {};

export function MediaTransport({
  playing,
  position,
  duration,
  isLoaded,
  seekable,
  onTogglePlay,
  onSeek = EMPTY_CALLBACK,
  onSeekStart = EMPTY_CALLBACK,
  onSeekEnd = EMPTY_CALLBACK,
}: MediaTransportProps) {
  const remaining = Math.max(0, duration - position);

  return (
    <View className="border-foreground/3 border-t px-2.5 pt-2.5 pb-3">
      <View className="flex-row items-center gap-3">
        <ControlIconButton
          icon={playing ? Pause : Play}
          iconSize={16}
          size="lg"
          disabled={!isLoaded}
          accessibilityLabel={playing ? "Pause media" : "Play media"}
          onPress={onTogglePlay}
        />
        <View className="min-w-0 flex-1">
          <Scrubber
            position={position}
            duration={duration}
            onSeek={onSeek}
            onSeekStart={onSeekStart}
            onSeekEnd={onSeekEnd}
            disabled={!isLoaded || !seekable || duration <= 0}
          />
        </View>
      </View>
      <View className="mt-1.5 flex-row justify-between">
        <Text
          className="text-foreground/95 text-10 min-w-0 flex-1 font-mono tabular-nums"
          numberOfLines={1}
        >
          {formatMinutesSeconds(position, { padMinutes: true })}
        </Text>
        <Text
          className="text-foreground/65 text-10 shrink-0 font-mono tabular-nums"
          numberOfLines={1}
        >
          -{formatMinutesSeconds(remaining, { padMinutes: true })}
        </Text>
      </View>
    </View>
  );
}
