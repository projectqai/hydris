import { DeviceState, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect } from "storybook/test";

import { ago, localClock, STORY_NOW } from "../../../../storybook/clock";
import { entity } from "../../../../storybook/entities";
import { StatusSection } from "./status-section";

const meta = {
  title: "Core/Aware/Configuration modal/StatusSection",
  component: StatusSection,
  argTypes: { entity: { control: false } },
  args: {
    entity: entity("radio-1", {
      device: { state: DeviceState.DeviceStateActive, uniqueHardwareId: "SN-48213-A" },
      mission: { destination: "North quay berth 4" },
      power: { batteryChargeRemaining: 0.82, voltage: 12.4, remainingSeconds: 5_400 },
      link: {
        status: LinkStatus.LinkStatusConnected,
        lastSeen: ago(90),
        lastLatencyMs: 42,
        linkQualityPercent: 87,
        rssiDbm: -61,
        snrDb: 12,
      },
    }),
  },
} satisfies Meta<typeof StatusSection>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement).toHaveTextContent(
      /StateActiveDestinationNorth quay berth 4Hardware IDSN-48213-A/,
    );
    await expect(canvas.getByText("Active")).toBeVisible();
    await expect(canvas.getByText("SN-48213-A")).toBeVisible();
    await expect(canvas.getByText("82%")).toBeVisible();
    await expect(canvas.getByText("12.4 V")).toBeVisible();
    await expect(canvas.getByText("1h 30m")).toBeVisible();
    await expect(canvas.getByText(localClock(STORY_NOW - 90_000))).toBeVisible();
    await expect(canvas.getByText("-61 dBm")).toBeVisible();
  },
};

export const NoStatus: Story = {
  args: { entity: entity("node-1", { label: "Hydris node" }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No status available")).toBeVisible();
  },
};

export const FailedDeviceLostLink: Story = {
  args: {
    entity: entity("cam-3", {
      device: { state: DeviceState.DeviceStateFailed },
      link: { status: LinkStatus.LinkStatusLost },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.getByText("Lost")).toBeVisible();
    await expect(canvas.queryByText("Destination")).toBeNull();
  },
};

export const Degraded: Story = {
  args: {
    entity: entity("cam-2", {
      device: { state: DeviceState.DeviceStateDegraded },
      link: { status: LinkStatus.LinkStatusDegraded, rssiDbm: -94 },
    }),
  },
};

export const PowerOnly: Story = {
  args: {
    entity: entity("battery-1", { power: { batteryChargeRemaining: 0.07, remainingSeconds: 900 } }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Power")).toBeVisible();
    await expect(canvas.queryByText("Device")).toBeNull();
    await expect(canvas.getByText("15m")).toBeVisible();
  },
};

export const LinkWithUnknownStatus: Story = {
  args: { entity: entity("relay-1", { link: { lastLatencyMs: 310 } }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unknown")).toBeVisible();
  },
};
