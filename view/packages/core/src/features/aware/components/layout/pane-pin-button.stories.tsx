import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { PinButton } from "./pane-pin-button";

const meta = {
  title: "Core/Aware/Layout/PinButton",
  component: PinButton,
  args: { pinned: false, onPress: fn() },
  parameters: { layout: "centered", a11y: { test: "todo" } },
} satisfies Meta<typeof PinButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Pin an entity")).toBeVisible();
    await expect(canvas.queryByLabelText("Change pinned entity")).toBeNull();
  },
};

export const Pinned: Story = {
  args: { pinned: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Change pinned entity")).toBeVisible();
    await expect(canvas.queryByLabelText("Pin an entity")).toBeNull();
  },
};

export const PinnedWhiteOnDark: Story = {
  args: { pinned: true, color: "#ffffff", size: 20 },
  decorators: [
    (Story) => (
      <View className="bg-black p-2">
        <Story />
      </View>
    ),
  ],
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Pin an entity"));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
