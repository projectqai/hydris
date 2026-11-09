import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, waitFor } from "storybook/test";

import { VideoPlayer } from "./video-player";

const meta = {
  title: "UI/Media/VideoPlayer",
  component: VideoPlayer,
  args: {
    url: "data:video/mp4;base64,",
    playing: false,
    onTogglePlay: fn(),
    onPositionCommit: fn(),
    onPlaybackStopped: fn(),
    onError: fn(),
  },
  decorators: [
    (Story) => (
      <View className="w-96">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof VideoPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(args.onError).toHaveBeenCalledWith("Unable to play video"));
  },
};
