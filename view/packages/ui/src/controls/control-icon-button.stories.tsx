import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Plus, Trash2 } from "lucide-react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ControlIconButton } from "./control-button";

const meta = {
  title: "UI/Controls/ControlIconButton",
  component: ControlIconButton,
  args: { icon: Plus, accessibilityLabel: "Add track", onPress: fn() },
  parameters: { layout: "centered", a11y: { test: "todo" } },
  argTypes: {
    icon: { control: "select", options: ["Plus", "Trash2"], mapping: { Plus, Trash2 } },
  },
} satisfies Meta<typeof ControlIconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

const isDisabled: Story["play"] = async ({ canvas }) => {
  await expect(canvas.getByLabelText("Add track")).toHaveAttribute("aria-disabled", "true");
};

export const Default: Story = {};

export const Active: Story = { args: { variant: "active" } };

export const Success: Story = { args: { variant: "success" } };

export const Destructive: Story = {
  args: { variant: "destructive", icon: Trash2, accessibilityLabel: "Delete track" },
};

export const Small: Story = { args: { size: "sm" } };

export const Large: Story = { args: { size: "lg" } };

export const Hovered: Story = { globals: { pseudo: { hover: true } } };

export const HoveredWithHoverVariant: Story = {
  args: { hoverVariant: "destructive", icon: Trash2, accessibilityLabel: "Delete track" },
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByLabelText("Delete track"));
  },
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Add track"));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvas }) => {
    const button = canvas.getByLabelText("Add track");

    await expect(button).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(button);
    await expect(args.onPress).not.toHaveBeenCalled();
  },
};

export const DisabledActive: Story = {
  args: { disabled: true, variant: "active" },
  play: isDisabled,
};

export const DisabledSuccess: Story = {
  args: { disabled: true, variant: "success" },
  play: isDisabled,
};

export const KeyboardFocused: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByLabelText("Add track")).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
