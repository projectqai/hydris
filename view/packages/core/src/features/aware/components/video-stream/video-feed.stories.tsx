import { create } from "@bufbuild/protobuf";
import { MediaStreamSchema } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, waitFor } from "storybook/test";

import { webrtc } from "../../../../storybook/entities";
import { cameraInPane, coreProviders } from "../../../../storybook/providers";
import { VideoFeed } from "./video-feed";

const mainStream = create(MediaStreamSchema, webrtc("Main", "/whep/simcam-3"));

const meta = {
  title: "Core/Aware/Video stream/VideoFeed",
  component: VideoFeed,
  tags: ["!autodocs"],
  args: { entityId: "simcam-3", stream: mainStream, index: 0, objectFit: "contain", enabled: true },
  argTypes: {
    stream: { control: false },
    objectFit: { control: "inline-radio", options: ["contain", "cover"] },
  },
  decorators: [
    (Story) => (
      <View className="aspect-video w-80">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof VideoFeed>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Connecting…")).toBeVisible();
  },
};

export const Disabled: Story = { args: { enabled: false } };

export const ShownInPane: Story = {
  decorators: [cameraInPane("simcam-3")],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Viewing in Pane")).toBeVisible();
  },
};

export const Preview: Story = {
  args: { onPreviewStatus: fn() },
  play: async ({ args, canvas }) => {
    await waitFor(() =>
      expect(args.onPreviewStatus).toHaveBeenLastCalledWith({ state: "connecting", error: null }),
    );
    await expect(canvas.queryByText("Connecting…")).toBeNull();
  },
};
