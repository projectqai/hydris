import { CATEGORY_IDS } from "@hydris/ui/command-palette/palette-reducer";
import { wholeText } from "@hydris/ui/storybook/queries";
import { ClassificationIdentity, ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { asset, equipmentAsset, track } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { DimensionView } from "./dimension-view";

const entities = [
  equipmentAsset("radar-1", "Harbour radar", { geo: { latitude: 53.54, longitude: 9.97 } }),
  equipmentAsset("radar-2", "North mast radar", {
    controller: { id: "ctl-west" },
    configurable: { state: ConfigurableState.ConfigurableStateFailed },
    config: {},
  }),
  equipmentAsset("cam-1", "Pier camera"),
  asset("gen-1", DeviceState.DeviceStateActive, undefined, { label: "Generator" }),
  track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, { label: "TANGO 21" }),
  track("trk-2", ClassificationIdentity.ClassificationIdentityHostile, {
    label: "HAWK 7",
    symbol: { milStd2525C: "SHAPMF----*****" },
  }),
];

const meta = {
  title: "Core/Aware/Command palette/Views/DimensionView",
  component: DimensionView,
  tags: ["!autodocs"],
  argTypes: { category: { control: "radio", options: CATEGORY_IDS } },
  args: { dimension: "Equipment", category: "assets", query: "", onClose: fn() },
  beforeEach: () => seedEntities(entities),
  decorators: [paletteView({ height: "h-80" })],
} satisfies Meta<typeof DimensionView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pier camera")).toBeVisible();
    await expect(canvas.getByText("ctl-west")).toBeVisible();
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.queryByText("Generator")).toBeNull();
    await expect(canvas.queryByText("TANGO 21")).toBeNull();
  },
};

export const Filtered: Story = {
  args: { query: "radar" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(wholeText("Harbour radar"))).toBeVisible();
    await expect(canvas.queryByText(wholeText("Pier camera"))).toBeNull();
  },
};

export const NoResults: Story = {
  args: { query: "sonar" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No results found")).toBeVisible();
  },
};

export const NoEntities: Story = {
  args: { dimension: "Vehicle" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No entities")).toBeVisible();
  },
};

export const TracksByBattleDimension: Story = {
  args: { category: "tracks", dimension: "Ground" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("TANGO 21")).toBeVisible();
    await expect(canvas.queryByText("HAWK 7")).toBeNull();
    await expect(canvas.queryByText("Harbour radar")).toBeNull();
  },
};

export const Truncated: Story = {
  beforeEach: () =>
    seedEntities(
      Array.from({ length: 120 }, (_, i) => equipmentAsset(`sensor-${i}`, `Sensor ${i + 1}`)),
    ),
  play: async ({ canvas }) => {
    for (let row = 2; row <= 100; row++) {
      await canvas.findByText(`Sensor ${row}`);
      await userEvent.keyboard("{ArrowDown}");
    }

    await expect(await canvas.findByText("Showing 100 of 120")).toBeVisible();
  },
};

export const ClosesOnPress: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Harbour radar"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
