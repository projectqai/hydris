import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { paneEntity } from "../../../storybook/providers";
import { SensorHeaderMeta } from "./widget-card";

type Args = ComponentProps<typeof SensorHeaderMeta> & { onPin: () => void };

const meta = {
  title: "Core/Sensors/SensorHeaderMeta",
  component: SensorHeaderMeta,
  args: { connectionState: "connected", textSize: 13, iconSize: 16, onPin: fn() },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <View className="flex-row items-center gap-2">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("...")).toBeVisible();
  },
};

export const HighSignal: Story = {
  args: { signalStrength: "high" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("HIGH")).toBeVisible();
  },
};

export const MediumSignal: Story = {
  args: { signalStrength: "med" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("MED")).toBeVisible();
  },
};

export const LowSignal: Story = {
  args: { signalStrength: "low" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("LOW")).toBeVisible();
  },
};

export const Reconnecting: Story = {
  args: { connectionState: "reconnecting", signalStrength: "high" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Reconnecting...")).toBeVisible();
  },
};

export const Disconnected: Story = {
  args: { connectionState: "disconnected", signalStrength: "high" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Disconnected")).toBeVisible();
  },
};

export const SilentMode: Story = {
  args: { isSilentMode: true },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Silent mode", { selector: "svg" })).toBeVisible();
  },
};

export const SensorError: Story = {
  args: { hasSensorError: true },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Sensor error", { selector: "svg" })).toBeVisible();
  },
};

export const Pinnable: Story = {
  parameters: { a11y: { test: "todo" } },
  decorators: [paneEntity()],
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Pin an entity"));
    await expect(args.onPin).toHaveBeenCalledOnce();
  },
};

export const Pinned: Story = {
  parameters: { a11y: { test: "todo" } },
  decorators: [paneEntity("rad-1")],
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Change pinned entity")).toBeVisible();
  },
};
