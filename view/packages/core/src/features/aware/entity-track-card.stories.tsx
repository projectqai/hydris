import { create } from "@bufbuild/protobuf";
import {
  ClassificationIdentity,
  ConfigurableState,
  DeviceState,
  GeoSpatialComponentSchema,
  LinkStatus,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ago, localClock, STORY_NOW } from "../../storybook/clock";
import { asset, entity, hostileTrack, readyAsset, track } from "../../storybook/entities";
import { seedEntities } from "../../storybook/seed";
import { EntityCard } from "./entity-track-card";

const hostile = hostileTrack();

const identity = (value: ClassificationIdentity, label: string) =>
  track("trk-2", value, { label, lifetime: { from: ago(600) } });

const meta = {
  title: "Core/Aware/EntityCard",
  component: EntityCard,
  argTypes: { entity: { control: false } },
  tags: ["!autodocs"],
  args: { entity: hostile, onPress: fn() },
  decorators: [
    (Story) => (
      <View className="w-72">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof EntityCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Red")).toBeVisible();
    await expect(canvas.getByText("110°")).toBeVisible();
    await expect(canvas.getByText("37°")).toBeVisible();
    await expect(canvas.getByText("34m")).toBeVisible();
    await expect(canvas.getByText("5 m/s")).toBeVisible();
    await expect(canvas.getByText("hub-north")).toBeVisible();
    await expect(canvas.getByText(localClock(STORY_NOW - 60_000))).toBeVisible();
    await expect(canvas.queryByText(localClock(STORY_NOW - 600_000))).toBeNull();
  },
};

export const Friend: Story = {
  args: { entity: identity(ClassificationIdentity.ClassificationIdentityFriend, "BLUE 4") },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Blue")).toBeVisible();
  },
};

export const Neutral: Story = {
  args: { entity: identity(ClassificationIdentity.ClassificationIdentityNeutral, "Ferry Aurora") },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Neutral")).toBeVisible();
  },
};

export const UnknownIdentity: Story = {
  args: { entity: identity(ClassificationIdentity.ClassificationIdentityPending, "Contact 7") },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unknown")).toBeVisible();
  },
};

export const Unclassified: Story = {
  args: {
    entity: entity("obj-1", { label: "Drifting buoy", geo: { latitude: 52.5, longitude: 13.4 } }),
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unclassified")).toBeVisible();
    await expect(canvas.getByText("N/A")).toBeVisible();
    await expect(canvas.getByText("--:--:--")).toBeVisible();
  },
};

export const Selected: Story = { args: { isSelected: true } };

export const ActiveAsset: Story = {
  args: { entity: readyAsset("radar-1") },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Active")).toBeVisible();
  },
};

export const FailedDevice: Story = {
  args: { entity: asset("cam-1", DeviceState.DeviceStateFailed, LinkStatus.LinkStatusLost) },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.queryByText("Lost")).toBeNull();
  },
};

export const FailedConfigOnActiveDevice: Story = {
  args: {
    entity: asset("sensor-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
      configurable: { state: ConfigurableState.ConfigurableStateFailed },
      config: {},
    }),
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.queryByText("Active")).toBeNull();
  },
};

export const LinkLost: Story = {
  args: { entity: asset("cam-2", DeviceState.DeviceStateActive, LinkStatus.LinkStatusLost) },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Lost")).toBeVisible();
    await expect(canvas.queryByText("Active")).toBeNull();
  },
};

export const NoPosition: Story = {
  args: {
    entity: asset("cam-3", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
      geo: undefined,
    }),
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No position")).toBeVisible();
  },
};

export const DistanceFromOwnPosition: Story = {
  beforeEach: () =>
    seedEntities([], {
      selfGeo: create(GeoSpatialComponentSchema, { latitude: 51.5309, longitude: 13.3847 }),
    }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("111.3km")).toBeVisible();
  },
};

export const LongNameInNarrowContainer: Story = {
  args: {
    entity: track("trk-3", ClassificationIdentity.ClassificationIdentityHostile, {
      label: "Unidentified low-flying rotary wing contact north ridge",
      controller: { id: "hub-north-perimeter-relay-station-4" },
    }),
  },
  decorators: [
    (Story) => (
      <View className="w-52">
        <Story />
      </View>
    ),
  ],
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("TANGO 21"));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
