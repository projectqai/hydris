import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { modeBar } from "../../../../storybook/mode-bar";
import { RangeBarContent } from "./range-bar-content";

const meta = {
  title: "Core/Aware/Top bar/RangeBarContent",
  component: RangeBarContent,
  args: { isTouchInput: false, label: "R&B", canUndo: true, onFinish: fn(), onUndo: fn() },
  decorators: [modeBar()],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof RangeBarContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Undoes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Undo range point"));
    await expect(args.onUndo).toHaveBeenCalledOnce();
  },
};

export const Finishes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Finish range and bearing"));
    await expect(args.onFinish).toHaveBeenCalledOnce();
  },
};

export const NothingToUndo: Story = {
  args: { canUndo: false },
  play: async ({ args, canvas }) => {
    const undo = canvas.getByLabelText("Undo range point");

    await expect(undo).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(undo);
    await expect(args.onUndo).not.toHaveBeenCalled();
  },
};

export const TouchHelpOpen: Story = {
  args: { isTouchInput: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Range help" }));
    await expect(await canvas.findByText("Hold")).toBeVisible();
    await expect(canvas.queryByText("Backspace")).toBeNull();
  },
};
