import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { expect } from "storybook/test";

import { VignetteGlow } from "./vignette-glow";
import { WidgetCard } from "./widget-card";

const meta = {
  title: "Core/Sensors/WidgetCard",
  component: WidgetCard,
  subcomponents: { VignetteGlow },
  argTypes: {
    status: { control: "radio", options: ["normal", "alarm", "cooldown", "disconnected"] },
    isLocked: { control: "boolean" },
    glowIntensity: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
  },
  decorators: [
    (Story) => (
      <View className="bg-muted h-48 w-64 p-2">
        <Story />
      </View>
    ),
  ],
  render: (args) => (
    <WidgetCard {...args}>
      <Text className="font-sans-semibold text-foreground text-lg">0.42 µSv/h</Text>
    </WidgetCard>
  ),
} satisfies Meta<typeof WidgetCard>;

export default meta;

type Story = StoryObj<typeof meta>;

const STATUS_TEXT = /^(Alarm|Cooldown|Disconnected)$/;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByText(STATUS_TEXT)).toBeNull();
  },
};

export const Alarm: Story = {
  args: { status: "alarm" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(STATUS_TEXT)).toHaveTextContent("Alarm");
  },
};

export const Cooldown: Story = {
  args: { status: "cooldown" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(STATUS_TEXT)).toHaveTextContent("Cooldown");
  },
};

export const Disconnected: Story = {
  args: { status: "disconnected" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(STATUS_TEXT)).toHaveTextContent("Disconnected");
  },
};

export const Locked: Story = {
  args: { isLocked: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Locked")).toBeVisible();
  },
};

export const Glow: Story = {
  args: { glowColor: "#ef4444", glowIntensity: 0.8 },
};
