import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Link2, Radio } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { LinkRow } from "./link-row";

const meta = {
  title: "Core/Aware/Entity details/LinkRow",
  component: LinkRow,
  args: {
    label: "Parent",
    value: "Radar North",
    accessibilityLabel: "Show Radar North",
    onPress: fn(),
  },
  argTypes: {
    icon: {
      control: "select",
      options: ["None", "Link2", "Radio"],
      mapping: { None: undefined, Link2, Radio },
    },
  },
  decorators: [
    (Story) => (
      <View className="w-72">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof LinkRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = { args: { icon: Radio, label: "Via" } };

export const LongValueInNarrowContainer: Story = {
  args: {
    value: "Perimeter radar relay north ridge station 4",
    accessibilityLabel: "Show Perimeter radar relay north ridge station 4",
  },
  decorators: [
    (Story) => (
      <View className="w-48">
        <Story />
      </View>
    ),
  ],
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("link", { name: "Show Radar North" }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
