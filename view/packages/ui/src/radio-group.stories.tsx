import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import { RadioGroup, RadioGroupItem } from "./radio-group";

type Option = { value: string; label: string };

type Args = {
  value: string;
  disabled?: boolean;
  accessibilityLabel: string;
  onValueChange: (value: string) => void;
  options: Option[];
  disabledOption?: string;
};

const PRIORITIES: Option[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const meta = {
  title: "UI/Controls/RadioGroup",
  args: {
    value: "low",
    accessibilityLabel: "Priority",
    onValueChange: fn(),
    options: PRIORITIES,
  },
  argTypes: {
    options: { control: false },
    disabledOption: { control: "select", options: PRIORITIES.map((o) => o.value) },
  },
  render: function Render({ value, options, disabledOption, ...args }) {
    const [, updateArgs] = useArgs<Args>();

    const onValueChange = (next: string) => {
      args.onValueChange(next);
      updateArgs({ value: next });
    };

    return (
      <RadioGroup {...args} value={value} onValueChange={onValueChange}>
        {options.map((o) => (
          <RadioGroupItem key={o.value} value={o.value} disabled={o.value === disabledOption}>
            {o.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    );
  },
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SelectsOption: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await userEvent.click(canvas.getByRole("radio", { name: "Medium" }));
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith("medium");
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const DisabledOption: Story = {
  args: { disabledOption: "high" },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await userEvent.click(canvas.getByRole("radio", { name: "Medium" }));
    await expect(args.onValueChange).toHaveBeenCalledWith("medium");
  },
};

export const NoMatchingValue: Story = {
  args: { value: "none" },
};

export const TabVisitsEveryEnabledItem: Story = {
  args: { value: "high", disabledOption: "medium" },
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveFocus();

    await userEvent.tab();
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveFocus();
  },
};

export const SpaceSelectsFocusedItem: Story = {
  args: { value: "low" },
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.getByRole("radio", { name: "Medium" })).toHaveFocus();

    await userEvent.keyboard(" ");
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith("medium");
  },
};

export const EnterSelectsFocusedItem: Story = {
  args: { value: "none" },
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect(args.onValueChange).toHaveBeenCalledOnce();
    await expect(args.onValueChange).toHaveBeenCalledWith("low");
  },
};

export const ArrowsMoveAndSelect: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "Medium" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("medium");

    await userEvent.keyboard("{ArrowDown}");
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("high");

    await userEvent.keyboard("{ArrowUp}");
    await expect(canvas.getByRole("radio", { name: "Medium" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("medium");

    await userEvent.keyboard("{ArrowLeft}");
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("low");
  },
};

export const ArrowsWrapAround: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("high");

    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("low");
  },
};

export const ArrowsSkipDisabledItem: Story = {
  args: { disabledOption: "medium" },
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("high");

    await userEvent.keyboard("{ArrowLeft}");
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveFocus();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("low");
  },
};

export const LongLabelInNarrowContainer: Story = {
  args: {
    value: "east",
    accessibilityLabel: "Station",
    options: [
      { value: "north", label: "North" },
      { value: "east", label: "East" },
      { value: "south", label: "South" },
      { value: "west", label: "West" },
      { value: "uplink", label: "Perimeter station 04 (secondary uplink)" },
    ],
  },
  decorators: [
    (Story) => (
      <View className="w-64">
        <Story />
      </View>
    ),
  ],
};
