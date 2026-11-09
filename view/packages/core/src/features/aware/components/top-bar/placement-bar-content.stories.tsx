import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { modeBar } from "../../../../storybook/mode-bar";
import { PlacementBarContent } from "./placement-bar-content";

const meta = {
  title: "Core/Aware/Top bar/PlacementBarContent",
  component: PlacementBarContent,
  args: { onConfirm: fn(), onAbort: fn(), onTypeCoordinates: fn() },
  decorators: [modeBar()],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof PlacementBarContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TypesCoordinates: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Enter coordinates manually"));
    await expect(args.onTypeCoordinates).toHaveBeenCalledOnce();
    await expect(args.onAbort).not.toHaveBeenCalled();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const Aborts: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Cancel placement"));
    await expect(args.onAbort).toHaveBeenCalledOnce();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const Confirms: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Confirm position"));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await expect(args.onAbort).not.toHaveBeenCalled();
  },
};
