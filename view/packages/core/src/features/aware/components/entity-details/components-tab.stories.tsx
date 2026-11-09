import { ClassificationIdentity, DeviceState, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { entity, track, webrtc } from "../../../../storybook/entities";
import { ComponentsTab } from "./components-tab";

const meta = {
  title: "Core/Aware/Entity details/ComponentsTab",
  component: ComponentsTab,
  argTypes: { entity: { control: false } },
  args: { entity: track("trk-1", ClassificationIdentity.ClassificationIdentityHostile) },
  decorators: [
    (Story) => (
      <View className="native:flex-1 w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ComponentsTab>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Active Components (2)")).toBeVisible();
    await expect(canvas.getByText("Tracked object")).toBeVisible();
    await expect(canvas.getByText("Position data")).toBeVisible();
  },
};

export const EveryComponent: Story = {
  args: {
    entity: entity("cam-1", {
      track: { tracker: "radar-1" },
      geo: {
        latitude: 52.52,
        longitude: 13.4,
        covariance: { mxx: 4.2, myy: 3.1, mzz: 9.8 },
      },
      kinematics: { velocityEnu: { east: 3, north: 4 } },
      bearing: { azimuth: 37 },
      camera: { streams: [webrtc("Main", "/whep/cam-1"), webrtc("Thermal", "/whep/cam-1-ir")] },
      detection: { detectorEntityId: "radar-1", confidence: 0.82 },
      link: { status: LinkStatus.LinkStatusDegraded },
      power: { batteryChargeRemaining: 0.64 },
      device: { state: DeviceState.DeviceStateFailed },
      locator: { locatedEntityId: "trk-1" },
      taskable: { label: "Point camera at track" },
      artifact: { contentType: "image/jpeg" },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Active Components (13)")).toBeVisible();
    await expect(canvas.getByText("2 feed(s)")).toBeVisible();
    await expect(canvas.getByText("Data link (Degraded)")).toBeVisible();
    await expect(canvas.getByText("Battery 64%")).toBeVisible();
    await expect(canvas.getByText("Device (Failed)")).toBeVisible();
    await expect(canvas.getByText("image/jpeg")).toBeVisible();
  },
};

export const MissingOptionalData: Story = {
  args: {
    entity: entity("relay-1", {
      link: {},
      power: {},
      artifact: {},
      camera: {},
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Data link (Unknown)")).toBeVisible();
    await expect(canvas.getByText("Battery —")).toBeVisible();
    await expect(canvas.getByText("Stored file")).toBeVisible();
    await expect(canvas.getByText("0 feed(s)")).toBeVisible();
  },
};

export const Empty: Story = {
  args: { entity: entity("node-1") },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No components")).toBeVisible();
  },
};
