import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, userEvent } from "storybook/test";

import { topBar } from "../storybook/top-bar";
import { DrawingHelpIcon } from "./drawing-help-icon";

const meta = {
  title: "UI/Navigation and menus/DrawingHelpIcon",
  component: DrawingHelpIcon,
  args: { isTouchInput: false, kind: "freeform" },
  argTypes: { kind: { control: "text" } },
  parameters: { layout: "centered" },
  decorators: [topBar("Drawing")],
} satisfies Meta<typeof DrawingHelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FreeformPointerOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Drawing help" }));
    await expect(await canvas.findByText("Ends an open line")).toBeVisible();
    await expect(canvas.getByText("Backspace")).toBeVisible();
  },
};

export const RangeBearingCircleTouchOpen: Story = {
  args: { isTouchInput: true, kind: "rb-circle" },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Drawing help" }));
    await expect(await canvas.findByText("Set how many before you finish")).toBeVisible();
    await expect(canvas.getByText("Hold")).toBeVisible();
  },
};
