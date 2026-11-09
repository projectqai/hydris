import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, userEvent } from "storybook/test";

import { topBar } from "../storybook/top-bar";
import { RangeHelpIcon } from "./range-help-icon";

const meta = {
  title: "UI/Navigation and menus/RangeHelpIcon",
  component: RangeHelpIcon,
  args: { isTouchInput: false },
  parameters: { layout: "centered" },
  decorators: [topBar("Range and bearing")],
} satisfies Meta<typeof RangeHelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PointerInputOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Range help" }));
    await expect(await canvas.findByText("Backspace")).toBeVisible();
    await expect(canvas.queryByText("Hold")).toBeNull();
  },
};

export const TouchInputOpen: Story = {
  args: { isTouchInput: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Range help" }));
    await expect(await canvas.findByText("Hold")).toBeVisible();
    await expect(canvas.queryByText("Backspace")).toBeNull();
  },
};
