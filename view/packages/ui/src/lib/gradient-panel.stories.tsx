import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text } from "react-native";

import { GradientPanel } from "./theme";

const meta = {
  title: "UI/Containers and surfaces/GradientPanel",
  component: GradientPanel,
  args: { className: "border-surface-overlay/10 h-28 w-40 justify-end rounded-xl border p-3" },
  parameters: { layout: "centered" },
  argTypes: { children: { control: false } },
  render: (args) => (
    <GradientPanel {...args}>
      <Text className="font-sans-medium text-13 text-foreground">Sector north</Text>
    </GradientPanel>
  ),
} satisfies Meta<typeof GradientPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Active: Story = { args: { variant: "active" } };

export const Dense: Story = { args: { variant: "dense" } };

export const Card: Story = { args: { variant: "card" } };
