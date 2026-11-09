import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";

import { MediaFrame } from "./media-frame";

const meta = {
  title: "UI/Media/MediaFrame",
  component: MediaFrame,
  argTypes: { children: { control: false } },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
  render: (args) => (
    <MediaFrame {...args}>
      <View className="flex-1 items-center justify-center">
        <Text className="text-11 font-mono text-white/60">no signal</Text>
      </View>
    </MediaFrame>
  ),
} satisfies Meta<typeof MediaFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
