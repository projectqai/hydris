import { KeyboardProvider } from "@hydris/ui/keyboard";
import { DeviceState, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { asset } from "../../../../../storybook/entities";
import { seedEntities } from "../../../../../storybook/seed";
import { AssetReadinessView } from "./asset-readiness-view";

const connected = LinkStatus.LinkStatusConnected;

const harbourRadar = asset("radar-1", DeviceState.DeviceStateActive, connected, {
  label: "Harbour radar",
});

const notReady = [
  asset("cam-2", DeviceState.DeviceStateActive, connected, {
    label: "Mast camera",
    geo: undefined,
  }),
  asset("cam-1", DeviceState.DeviceStatePending, connected, { label: "Pier camera" }),
  asset("relay-1", DeviceState.DeviceStateFailed, undefined, { label: "Relay" }),
  asset("wx-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusLost, {
    label: "Weather station",
  }),
];

const meta = {
  title: "Core/Aware/Command palette/Views/AssetReadinessView",
  component: AssetReadinessView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { query: "", dispatch: fn() },
  beforeEach: () => seedEntities([harbourRadar, ...notReady]),
  decorators: [
    (Story) => (
      <KeyboardProvider>
        <View className="native:flex-1 native:w-full h-[440px] w-[560px]">
          <Story />
        </View>
      </KeyboardProvider>
    ),
  ],
} satisfies Meta<typeof AssetReadinessView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Mast camera")).toBeVisible();
    await expect(canvas.getByText("Lost")).toBeVisible();
    await expect(canvas.queryByText("Harbour radar")).toBeNull();
  },
};

export const AllReady: Story = {
  beforeEach: () => seedEntities([harbourRadar]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Harbour radar")).toBeVisible();
    await expect(canvas.queryByText("Not ready")).toBeNull();
  },
};

export const NoAssets: Story = {
  beforeEach: () => seedEntities([]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No assets")).toBeVisible();
  },
};

export const Filtered: Story = {
  args: { query: "camera" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pier camera")).toBeVisible();
    await expect(canvas.queryByText("Relay")).toBeNull();
  },
};

export const ShowsReadyGroup: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Ready"));
    await waitFor(() => expect(canvas.getByText("Harbour radar")).toBeVisible());
  },
};

export const OpensAssetWithKeyboard: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await canvas.findByText("Ready");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");
    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "asset", entityId: "cam-1" },
    });
  },
};
