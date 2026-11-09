import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Inbox, Radar } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ControlButton } from "./controls/control-button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyLink,
  EmptyMedia,
  EmptyTitle,
} from "./empty-state";

const meta = {
  title: "UI/Feedback and status/Empty",
  component: Empty,
  args: { variant: "default" },
  argTypes: { variant: { control: "radio", options: ["default", "small"] } },
  render: (args) => (
    <Empty {...args}>
      <EmptyTitle>No tracks</EmptyTitle>
    </Empty>
  ),
  decorators: [
    (Story) => (
      <View className="h-40 w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof Empty>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { variant: "small" } };

export const CustomIconColor: Story = {
  args: { variant: "small" },
  render: (args) => (
    <Empty {...args}>
      <EmptyMedia icon={Radar} color="rgb(59, 130, 246)" />
      <EmptyTitle>No sensors in range</EmptyTitle>
    </Empty>
  ),
};

export const WithLink: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyDescription>
        Connect a sensor or <EmptyLink onPress={fn()}>add a plugin</EmptyLink>.
      </EmptyDescription>
    </Empty>
  ),
};

const onSaveLayout = fn().mockName("onSaveLayout");

export const WithContent: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyMedia icon={Inbox} />
      <EmptyTitle>No saved layouts</EmptyTitle>
      <EmptyDescription>Save the current layout to reuse it later.</EmptyDescription>
      <EmptyContent>
        <ControlButton
          label="Save layout"
          size="sm"
          accessibilityLabel="Save layout"
          onPress={onSaveLayout}
        />
      </EmptyContent>
    </Empty>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Save layout"));
    await expect(onSaveLayout).toHaveBeenCalledOnce();
  },
};

export const LongDescriptionInNarrowContainer: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyMedia icon={Inbox} />
      <EmptyTitle>No tracks</EmptyTitle>
      <EmptyDescription>
        Tracks appear here once a sensor on the perimeter network reports a confirmed detection.
      </EmptyDescription>
    </Empty>
  ),
  decorators: [
    (Story) => (
      <View className="w-48 flex-1">
        <Story />
      </View>
    ),
  ],
};
