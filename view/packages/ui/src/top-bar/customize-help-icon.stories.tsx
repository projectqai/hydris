import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, userEvent } from "storybook/test";

import { topBar } from "../storybook/top-bar";
import { CustomizeHelpIcon } from "./customize-help-icon";

const meta = {
  title: "UI/Navigation and menus/CustomizeHelpIcon",
  component: CustomizeHelpIcon,
  parameters: { layout: "centered" },
  decorators: [topBar("Editing Layout", "customize")],
} satisfies Meta<typeof CustomizeHelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Layout editing help" }));
    await expect(await canvas.findByText("Exit editing mode")).toBeVisible();
  },
};
