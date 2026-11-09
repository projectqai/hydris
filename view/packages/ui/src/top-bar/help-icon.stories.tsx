import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, userEvent, waitFor } from "storybook/test";

import { HelpIcon } from "./help-icon";

const meta = {
  title: "UI/Navigation and menus/HelpIcon",
  component: HelpIcon,
  args: {
    label: "Help",
    color: "rgb(148, 148, 148)",
    items: [
      { key: "Esc", text: "Close" },
      { key: "Enter or double-click", text: "Finish the shape and keep every change made so far" },
    ],
  },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-64">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof HelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ShowsOnHover: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Help" });

    await userEvent.hover(button);
    await expect(await canvas.findByText("Close")).toBeVisible();

    await userEvent.unhover(button);
    await waitFor(() => expect(canvas.queryByText("Close")).toBeNull());
  },
};

export const ShowsOnFocus: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Help" })).toHaveFocus();
    await expect(await canvas.findByText("Close")).toBeVisible();
  },
};

export const EnterPinsOpen: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "Help" });

    await userEvent.tab();
    await expect(button).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    await expect(button).not.toHaveFocus();
    await expect(canvas.getByText("Close")).toBeVisible();
  },
};

export const PressPinsOpen: Story = {
  play: async ({ canvas, canvasElement }) => {
    const button = canvas.getByRole("button", { name: "Help" });
    const pressAndLeave = async () => {
      await userEvent.click(button);
      await userEvent.unhover(button);
      await userEvent.click(canvasElement);
      await expect(button).not.toHaveFocus();
    };

    await pressAndLeave();
    await expect(canvas.getByText("Close")).toBeVisible();

    await pressAndLeave();
    await waitFor(() => expect(canvas.queryByText("Close")).toBeNull());
  },
};
