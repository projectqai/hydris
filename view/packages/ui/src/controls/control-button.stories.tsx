import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Plus, Trash2 } from "lucide-react-native";
import { Text, View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { pressable } from "../storybook/queries";
import { ControlButton } from "./control-button";

const customChildren = (
  <Text className="text-13 text-foreground font-sans-semibold">
    Custom <Text className="text-foreground/60 font-sans">content</Text>
  </Text>
);

const meta = {
  title: "UI/Controls/ControlButton",
  component: ControlButton,
  args: { label: "Save layout", onPress: fn() },
  parameters: { layout: "centered" },
  argTypes: {
    children: {
      control: "select",
      options: ["None", "Custom"],
      mapping: { None: undefined, Custom: customChildren },
    },
    icon: {
      control: "select",
      options: ["None", "Plus", "Trash2"],
      mapping: { None: undefined, Plus, Trash2 },
    },
  },
} satisfies Meta<typeof ControlButton>;

export default meta;

type Story = StoryObj<typeof meta>;

const isDisabled: Story["play"] = async ({ canvas }) => {
  await expect(pressable(canvas.getByText("Save layout"))).toHaveAttribute("aria-disabled", "true");
};

export const Default: Story = {};

export const Active: Story = { args: { variant: "active" } };

export const Success: Story = { args: { variant: "success" } };

export const Destructive: Story = { args: { variant: "destructive", label: "Delete track" } };

export const Small: Story = { args: { size: "sm" } };

export const Large: Story = { args: { size: "lg" } };

export const WithIcon: Story = { args: { icon: Plus, label: "Add track" } };

export const DestructiveWithIcon: Story = {
  args: { variant: "destructive", icon: Trash2, label: "Delete" },
};

export const Loading: Story = {
  args: { loading: true, label: "Saving" },
  parameters: { a11y: { test: "todo" } },
};

export const LoadingSuccess: Story = {
  args: { loading: true, label: "Saving", variant: "success" },
  parameters: { a11y: { test: "todo" } },
};

export const FullWidth: Story = {
  args: { fullWidth: true },
  decorators: [
    (Story) => (
      <View className="w-72">
        <Story />
      </View>
    ),
  ],
};

export const LongLabelInNarrowContainer: Story = {
  args: { label: "Save layout and notify every connected operator" },
  decorators: [
    (Story) => (
      <View className="w-40">
        <Story />
      </View>
    ),
  ],
};

export const CustomChildren: Story = {
  args: { label: undefined, accessibilityLabel: "Custom content", children: "Custom" },
};

export const Hovered: Story = { globals: { pseudo: { hover: true } } };

export const HoveredWithHoverVariant: Story = {
  args: { hoverVariant: "destructive", label: "Delete track" },
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByText("Delete track"));
  },
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Save layout"));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvas }) => {
    const button = pressable(canvas.getByText("Save layout"));

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
    await expect(pressable(canvas.getByText("Save layout"))).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
