import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import { SegmentedControl } from "./segmented-control";

const meta = {
  title: "UI/Controls/SegmentedControl",
  component: SegmentedControl,
  args: {
    tabs: [
      { id: "list", label: "List" },
      { id: "map", label: "Map" },
    ],
    activeTab: "list",
    onTabChange: fn(),
  },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<ComponentProps<typeof SegmentedControl>>();

    return (
      <SegmentedControl
        {...args}
        onTabChange={(activeTab) => {
          args.onTabChange(activeTab);
          updateArgs({ activeTab });
        }}
      />
    );
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThreeSegments: Story = {
  args: {
    tabs: [
      { id: "all", label: "All" },
      { id: "friendly", label: "Friendly" },
      { id: "hostile", label: "Hostile" },
    ],
    activeTab: "all",
  },
};

export const ChangesSegment: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Map"));
    await expect(args.onTabChange).toHaveBeenCalledOnce();
    await expect(args.onTabChange).toHaveBeenCalledWith("map");
  },
};

export const ChangesSegmentWithEnter: Story = {
  play: async ({ args }) => {
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect(args.onTabChange).toHaveBeenCalledOnce();
    await expect(args.onTabChange).toHaveBeenCalledWith("map");
  },
};
