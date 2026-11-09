import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { ArrowLeftRight, Columns, Rows, X } from "lucide-react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ActionButton } from "./action-button";

const meta = {
  title: "UI/Controls/ActionButton",
  component: ActionButton,
  args: { icon: Columns, label: "Split into columns", onPress: fn() },
  parameters: { layout: "centered", a11y: { test: "todo" } },
  argTypes: {
    icon: {
      control: "select",
      options: ["Columns", "Rows", "ArrowLeftRight", "X"],
      mapping: { Columns, Rows, ArrowLeftRight, X },
    },
  },
} satisfies Meta<typeof ActionButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Hovered: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByLabelText("Split into columns"));
  },
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Split into columns"));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
