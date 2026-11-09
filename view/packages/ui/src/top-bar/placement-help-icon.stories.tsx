import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, userEvent } from "storybook/test";

import { topBar } from "../storybook/top-bar";
import { PlacementHelpIcon } from "./placement-help-icon";

const meta = {
  title: "UI/Navigation and menus/PlacementHelpIcon",
  component: PlacementHelpIcon,
  parameters: { layout: "centered" },
  decorators: [topBar("Set position")],
} satisfies Meta<typeof PlacementHelpIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Placement help" }));
    await expect(await canvas.findByText("Cancel placement")).toBeVisible();
  },
};
