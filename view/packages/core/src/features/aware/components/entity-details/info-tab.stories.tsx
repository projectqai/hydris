import {
  ClassificationIdentity,
  ConfigurableState,
  DeviceState,
  LinkStatus,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { setStringAsync } from "expo-clipboard";
import { View } from "react-native";
import { expect, screen, userEvent } from "storybook/test";

import { ago, localClock, STORY_NOW } from "../../../../storybook/clock";
import { asset, entity, track } from "../../../../storybook/entities";
import { seedEntities } from "../../../../storybook/seed";
import { InfoTab } from "./info-tab";

const meta = {
  title: "Core/Aware/Entity details/InfoTab",
  component: InfoTab,
  argTypes: { entity: { control: false } },
  tags: ["!autodocs"],
  args: {
    entity: track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, {
      lifetime: { from: ago(600), until: ago(-3600) },
    }),
  },
  decorators: [
    (Story) => (
      <View className="native:flex-1 w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof InfoTab>;

export default meta;

type Story = StoryObj<typeof meta>;

const relay = entity("relay-7", { label: "Mesh relay north" });
const node = entity("node-1", { label: "Hydris node" });

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("SHGPUCR---*****")).toBeVisible();
    await expect(canvas.getByText(localClock(STORY_NOW - 600_000))).toBeVisible();
    await expect(canvas.getByText(localClock(STORY_NOW + 3_600_000))).toBeVisible();
  },
};

export const CopySymbolShowsToast: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Copy military symbol"));
    await expect(setStringAsync).toHaveBeenCalledWith("SHGPUCR---*****");
    await expect(await screen.findByText("Copied to clipboard")).toBeInTheDocument();
  },
};

export const ConnectedAsset: Story = {
  args: {
    entity: asset("radar-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
      link: { status: LinkStatus.LinkStatusConnected, rssiDbm: -61, snrDb: 12 },
      power: { batteryChargeRemaining: 0.87, voltage: 12.36, remainingSeconds: 15_300 },
      device: { state: DeviceState.DeviceStateActive, uniqueHardwareId: "02:00:00:11:3A:B7" },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Connected")).toBeVisible();
    await expect(canvas.getByText("-61 dBm")).toBeVisible();
    await expect(canvas.getByText("12 dB")).toBeVisible();
    await expect(canvas.getByText("87%")).toBeVisible();
    await expect(canvas.getByText("12.4 V")).toBeVisible();
    await expect(canvas.getByText("4h 15m")).toBeVisible();
    await expect(canvas.getByText("02:00:00:11:3A:B7")).toBeVisible();
    await expect(canvas.queryByText("Destination")).toBeNull();
  },
};

export const DegradedAsset: Story = {
  args: {
    entity: asset("cam-2", DeviceState.DeviceStateDegraded, LinkStatus.LinkStatusDegraded),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText("Degraded")).toHaveLength(2);
  },
};

export const DegradedDeviceShowsError: Story = {
  args: {
    entity: asset("cam-5", DeviceState.DeviceStateDegraded, LinkStatus.LinkStatusConnected, {
      device: { state: DeviceState.DeviceStateDegraded, error: "storage 94% full" },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent(/StateDegradedErrorstorage 94% full/);
  },
};

export const PendingAssetWithUnknownLink: Story = {
  args: {
    entity: asset("cam-3", DeviceState.DeviceStatePending, LinkStatus.LinkStatusUnspecified),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unknown")).toBeVisible();
    await expect(canvas.getByText("Pending")).toBeVisible();
  },
};

export const FailedDevice: Story = {
  args: {
    entity: asset("cam-4", DeviceState.DeviceStateFailed, LinkStatus.LinkStatusLost, {
      device: { state: DeviceState.DeviceStateFailed, error: "RTSP handshake timed out" },
      mission: { destination: "North quay berth 4" },
    }),
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.getByText("Lost")).toBeVisible();
    await expect(canvas.getByText("RTSP handshake timed out")).toBeVisible();
    await expect(canvasElement).toHaveTextContent(
      /StateFailedDestinationNorth quay berth 4ErrorRTSP handshake timed out/,
    );
  },
};

export const FailedConfigOnActiveDevice: Story = {
  args: {
    entity: asset("sensor-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
      configurable: {
        state: ConfigurableState.ConfigurableStateFailed,
        error: "connection refused by host",
      },
      config: {},
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent(/StateActiveConfigFailed/);
  },
};

export const ResolvedLinks: Story = {
  args: {
    entity: asset("cam-5", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
      link: { status: LinkStatus.LinkStatusConnected, via: "relay-7" },
      device: { state: DeviceState.DeviceStateActive, parent: "node-1" },
    }),
  },
  beforeEach: () => seedEntities([relay, node]),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Navigate to Hydris node" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Navigate to Mesh relay north" })).toBeVisible();
  },
};

export const UnresolvedLinks: Story = {
  args: {
    entity: asset("cam-6", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
      link: { status: LinkStatus.LinkStatusConnected, via: "relay-0042-east" },
      device: { state: DeviceState.DeviceStateActive, parent: "node-0007-west" },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Navigate to relay-00" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Navigate to node-000" })).toBeVisible();
  },
};

export const Empty: Story = {
  args: { entity: entity("node-2") },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No data available")).toBeVisible();
  },
};
