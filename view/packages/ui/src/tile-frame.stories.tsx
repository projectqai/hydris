import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";

import { TileFrame } from "./tile-frame";

const meta = {
  title: "UI/Containers and surfaces/TileFrame",
  component: TileFrame,
  argTypes: { children: { control: false }, className: { control: "text" } },
  decorators: [
    (Story) => (
      <View className="bg-muted h-40 w-72 p-2">
        <Story />
      </View>
    ),
  ],
  render: (args) => (
    <TileFrame {...args}>
      <Text className="font-sans-medium text-13 text-foreground">Tile content</Text>
      <Text className="text-11 text-foreground font-sans">Padding from METRIC_TOKENS</Text>
    </TileFrame>
  ),
} satisfies Meta<typeof TileFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OverflowingContentClips: Story = {
  render: (args) => (
    <TileFrame {...args}>
      {Array.from({ length: 12 }, (_, i) => (
        <Text key={i} className="text-13 text-foreground font-sans">
          Track {i + 1} TANGO {20 + i}
        </Text>
      ))}
    </TileFrame>
  ),
};
