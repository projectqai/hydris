import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ConnectionOverlay } from "./connection-overlay";

const meta = {
  title: "Core/Aware/Video stream/ConnectionOverlay",
  component: ConnectionOverlay,
  argTypes: { error: { control: "text" } },
  args: { state: "connecting", error: null, onRetry: fn() },
  decorators: [
    (Story, { parameters }) => (
      <View testID="stream" className={`relative bg-black/20 ${parameters.tile}`}>
        <Story />
      </View>
    ),
  ],
  parameters: { tile: "h-44 w-80" },
} satisfies Meta<typeof ConnectionOverlay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Idle: Story = {
  args: { state: "idle" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Connecting…")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export const Reconnecting: Story = {
  args: { state: "reconnecting", error: "Connection lost" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Reconnecting…")).toBeVisible();
    await expect(canvas.queryByText("Connection lost")).toBeNull();
  },
};

export const Connected: Story = {
  args: { state: "connected" },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("stream")).toBeEmptyDOMElement();
  },
};

export const Failed: Story = {
  args: { state: "failed" },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Connection failed")).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Retry connection" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const FailedWithError: Story = {
  args: { state: "failed", error: "WHEP error: 404" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("WHEP error: 404")).toBeVisible();
    await expect(canvas.queryByText("Connection failed")).toBeNull();
  },
};

export const NetworkError: Story = {
  args: { state: "failed", error: "ICE gathering timed out" },
};

export const LongErrorInSmallTile: Story = {
  args: {
    state: "failed",
    error: "Stream unavailable (server rejected request) after five reconnect attempts",
  },
  parameters: { tile: "h-28 w-48" },
};
