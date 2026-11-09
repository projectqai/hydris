import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ControlInput } from "./control-input";

const metres = <Text className="text-on-surface/65 pr-3 font-mono text-xs">m</Text>;

const meta = {
  title: "UI/Controls/ControlInput",
  component: ControlInput,
  args: {
    placeholder: "Search entities",
    accessibilityLabel: "Search entities",
    onChangeText: fn(),
    onFocus: fn(),
    onBlur: fn(),
  },
  argTypes: {
    suffix: {
      control: "select",
      options: ["None", "Metres"],
      mapping: { None: undefined, Metres: metres },
    },
  },
  decorators: [
    (Story) => (
      <View className="w-72">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ControlInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = { args: { value: "TANGO 21" } };

export const NumericWithSuffix: Story = {
  args: { value: "1500", keyboardType: "numeric", suffix: metres, accessibilityLabel: "Altitude" },
};

export const ReadOnly: Story = {
  args: { value: "Read only", editable: false },
};

export const ReportsTypedText: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByLabelText("Search entities"), "TANGO");
    await expect(args.onChangeText).toHaveBeenCalledTimes(5);
    await expect(args.onChangeText).toHaveBeenLastCalledWith("TANGO");
  },
};

export const Focused: Story = {
  play: async ({ args, canvas }) => {
    const input = canvas.getByLabelText("Search entities");

    await userEvent.click(input);
    await expect(input).toHaveFocus();
    await expect(args.onFocus).toHaveBeenCalledOnce();

    await userEvent.tab();
    await expect(input).not.toHaveFocus();
    await expect(args.onBlur).toHaveBeenCalledOnce();
  },
};
