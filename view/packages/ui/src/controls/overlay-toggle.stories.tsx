import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Layers, Radar } from "lucide-react-native";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import type { OverlayToggleProps } from "./overlay-toggle";
import { OverlayToggle } from "./overlay-toggle";

const meta = {
  title: "UI/Controls/OverlayToggle",
  component: OverlayToggle,
  args: { label: "Hostile", color: "red", isActive: true, onToggle: fn() },
  parameters: { layout: "centered" },
  argTypes: {
    icon: {
      control: "select",
      options: ["None", "Layers", "Radar"],
      mapping: { None: undefined, Layers, Radar },
    },
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs<OverlayToggleProps>();

    return (
      <OverlayToggle
        {...args}
        onToggle={() => {
          args.onToggle();
          updateArgs({ isActive: !args.isActive });
        }}
      />
    );
  },
} satisfies Meta<typeof OverlayToggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Yellow: Story = { args: { label: "Unknown", color: "yellow" } };

export const Blue: Story = { args: { label: "Friendly", color: "blue" } };

export const Green: Story = { args: { label: "Neutral", color: "green" } };

export const Gray: Story = { args: { label: "Pending", color: "gray" } };

export const Inactive: Story = { args: { isActive: false } };

export const WithIcon: Story = { args: { label: "Layers", color: undefined, icon: Layers } };

export const WithIconInactive: Story = {
  args: { label: "Layers", color: undefined, icon: Layers, isActive: false },
};

export const NoColorOrIcon: Story = { args: { label: "Labels", color: undefined } };

export const NoColorOrIconInactive: Story = {
  args: { label: "Labels", color: undefined, isActive: false },
};

export const LongLabelInNarrowContainer: Story = {
  args: { label: "Restricted airspace boundaries" },
  decorators: [
    (Story) => (
      <View className="w-48">
        <Story />
      </View>
    ),
  ],
};

export const Toggles: Story = {
  args: { label: "Sensor coverage", color: undefined, icon: Radar },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Sensor coverage"));
    await expect(args.onToggle).toHaveBeenCalledOnce();
  },
};
