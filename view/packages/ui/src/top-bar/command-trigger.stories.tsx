import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { CommandTrigger } from "./command-trigger";

const meta = {
  title: "UI/Navigation and menus/CommandTrigger",
  component: CommandTrigger,
  args: { onPress: fn() },
  parameters: { layout: "centered" },
} satisfies Meta<typeof CommandTrigger>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Mission" }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const Running: Story = { args: { status: { severity: "success" } } };

export const Pending: Story = { args: { status: { severity: "pending", label: "Starting" } } };

export const Alert: Story = {
  args: { status: { severity: "alert", label: "Failed" } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("K")).toBeNull();
  },
};
