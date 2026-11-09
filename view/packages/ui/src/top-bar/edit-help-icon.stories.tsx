import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, userEvent } from "storybook/test";

import { topBar } from "../storybook/top-bar";
import { EditHelpIcon } from "./edit-help-icon";

const meta = {
  title: "UI/Navigation and menus/EditHelpIcon",
  component: EditHelpIcon,
  args: { isTouchInput: false, kind: "circle" },
  argTypes: { kind: { control: "text" } },
  parameters: { layout: "centered" },
  decorators: [topBar("Editing shape")],
} satisfies Meta<typeof EditHelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CirclePointerOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Edit help" }));
    await expect(await canvas.findByText("Drag it to change the radius")).toBeVisible();
    await expect(canvas.getByText("Backspace")).toBeVisible();
  },
};

export const FreeformTouchOpen: Story = {
  args: { isTouchInput: true, kind: "freeform" },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Edit help" }));
    await expect(await canvas.findByText("Hold a segment")).toBeVisible();
    await expect(canvas.getByText("Finish")).toBeVisible();
  },
};
