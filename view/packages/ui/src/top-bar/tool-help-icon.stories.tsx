import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, userEvent } from "storybook/test";

import { topBar } from "../storybook/top-bar";
import { ToolHelpIcon } from "./tool-help-icon";

const meta = {
  title: "UI/Navigation and menus/ToolHelpIcon",
  component: ToolHelpIcon,
  args: {
    label: "Measure help",
    items: [
      { key: "Click", text: "Place a point" },
      { key: "Esc", text: "Stop measuring" },
    ],
  },
  parameters: { layout: "centered" },
  decorators: [topBar("Measure")],
} satisfies Meta<typeof ToolHelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Measure help" }));
    await expect(await canvas.findByText("Place a point")).toBeVisible();
    await expect(canvas.getByText("Stop measuring")).toBeVisible();
  },
};
