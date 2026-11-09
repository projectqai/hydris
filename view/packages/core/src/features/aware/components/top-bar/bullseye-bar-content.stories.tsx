import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { modeBar } from "../../../../storybook/mode-bar";
import { BullseyeBarContent } from "./bullseye-bar-content";

const meta = {
  title: "Core/Aware/Top bar/BullseyeBarContent",
  component: BullseyeBarContent,
  args: { onCancel: fn() },
  decorators: [modeBar({ helpRoom: false })],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof BullseyeBarContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Cancels: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Bullseye")).toBeVisible();

    await userEvent.click(canvas.getByLabelText("Cancel bullseye"));
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};
