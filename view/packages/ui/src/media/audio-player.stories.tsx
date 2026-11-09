import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, waitFor } from "storybook/test";

import { AudioPlayer } from "./audio-player";
import type { MediaPlayerProps } from "./types";

const meta = {
  title: "UI/Media/AudioPlayer",
  component: AudioPlayer,
  args: {
    // relative, so it loads when Storybook is served from a subpath
    url: "fixtures/silence-20s.mp3",
    playing: false,
    onTogglePlay: fn(),
    onPositionCommit: fn(),
    onPlaybackStopped: fn(),
    onError: fn(),
  },
  parameters: { a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<MediaPlayerProps>();

    return (
      <AudioPlayer
        {...args}
        onTogglePlay={() => {
          args.onTogglePlay();
          updateArgs({ playing: !args.playing });
        }}
        onPlaybackStopped={(position) => {
          args.onPlaybackStopped(position);
          updateArgs({ playing: false });
        }}
      />
    );
  },
} satisfies Meta<typeof AudioPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ResumesFromSavedPosition: Story = {
  args: { initialPosition: 12 },
};

export const UnplayableSource: Story = {
  args: { url: "data:audio/wav;base64," },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onError).toHaveBeenCalledWith("Unable to play audio"));
  },
};
