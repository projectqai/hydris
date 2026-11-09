import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";

import { Tag } from "./tag";

const meta = {
  title: "UI/Feedback and status/Tag",
  component: Tag,
  args: { children: "12" },
  parameters: { layout: "centered" },
  argTypes: { children: { control: "text" } },
} satisfies Meta<typeof Tag>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InlineBesideLabel: Story = {
  args: { children: "128" },
  decorators: [
    (Story) => (
      <View className="flex-row items-center gap-1.5">
        <Text className="text-foreground/75 font-sans-medium text-xs">Tracks</Text>
        <Story />
      </View>
    ),
  ],
};
