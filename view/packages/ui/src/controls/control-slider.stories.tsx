import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, waitFor } from "storybook/test";

import { drag, trackPoint } from "../storybook/pointer";
import type { ControlSliderProps } from "./control-slider";
import { ControlSlider } from "./control-slider";

const meta = {
  title: "UI/Controls/ControlSlider",
  component: ControlSlider,
  args: {
    value: 1500,
    min: 0,
    max: 5000,
    step: 100,
    unit: "m",
    accessibilityLabel: "Altitude",
    onValueChange: fn(),
  },
  parameters: { a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="w-72">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<ControlSliderProps>();

    return (
      <ControlSlider
        {...args}
        onValueChange={(value) => {
          args.onValueChange(value);
          updateArgs({ value });
        }}
      />
    );
  },
} satisfies Meta<typeof ControlSlider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DecimalStepNoUnit: Story = {
  args: { value: 0.4, min: 0, max: 1, step: 0.1, unit: undefined },
};

export const Empty: Story = { args: { value: 0, min: 0, max: 100, step: 1, unit: "%" } };

export const Full: Story = { args: { value: 100, min: 0, max: 100, step: 1, unit: "%" } };

export const Compact: Story = {
  args: { value: 60, min: 0, max: 100, step: 5, unit: undefined, compact: true },
};

export const ReadOnly: Story = {
  args: { value: 40, min: 0, max: 100, step: 1, unit: "%", readOnly: true },
  play: async ({ args, canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Altitude" });

    await drag(trackPoint(slider, 0.4), trackPoint(slider, 0.6), { steps: 1 });
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const ReadOnlyCompact: Story = {
  args: { value: 40, min: 0, max: 100, step: 1, unit: undefined, readOnly: true, compact: true },
};

export const DragsToValue: Story = {
  play: async ({ args, canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Altitude" });
    const start = trackPoint(slider, (args.value - args.min) / (args.max - args.min));

    await expect(slider).toHaveAttribute("aria-valuenow", String(args.value));

    await drag(start, trackPoint(slider, 0.5), { steps: 1 });
    await waitFor(() => expect(args.onValueChange).toHaveBeenNthCalledWith(1, 2500));
  },
};
