import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";

import { HighlightText } from "./highlight-text";

const meta = {
  title: "UI/Text and data/HighlightText",
  component: HighlightText,
  args: {
    text: "Center map on entity",
    ranges: [],
    className: "text-foreground/75 font-sans text-sm",
    highlightClassName: "text-blue-foreground",
  },
} satisfies Meta<typeof HighlightText>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PrefixRange: Story = { args: { ranges: [0, 6] } };

export const MiddleRange: Story = { args: { ranges: [7, 10] } };

export const MultipleRanges: Story = { args: { ranges: [0, 1, 7, 8, 14, 15] } };

export const LongTextInNarrowContainer: Story = {
  args: { text: "sensor-array-north-perimeter-station-04", ranges: [13, 18] },
  decorators: [
    (Story) => (
      <View className="w-48">
        <Story />
      </View>
    ),
  ],
};
