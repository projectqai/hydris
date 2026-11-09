import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { coreProviders, placement } from "../../../../storybook/providers";
import { seed } from "../../../../storybook/seed";
import { useEditStore } from "../../store/edit-store";
import { useMapEngineStore } from "../../store/map-engine-store";
import { useMapStore } from "../../store/map-store";
import { MapStepLine } from "./map-step-line";

const meta = {
  title: "Core/Aware/Panes/MapStepLine",
  component: MapStepLine,
  tags: ["!autodocs"],
  decorators: [
    (Story) => (
      <View className="relative h-40 w-96 bg-black/20">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof MapStepLine>;

export default meta;

type Story = StoryObj<typeof meta>;

const placing = coreProviders(placement({ isPlacing: true }));

export const Default: Story = {
  decorators: [placing],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pan the map, then Confirm")).toBeVisible();
  },
};

export const StreetLayer: Story = {
  decorators: [placing],
  beforeEach: () => seed(useMapStore, { layer: "street" }),
};

export const LongStepInNarrowPane: Story = {
  decorators: [
    coreProviders(),
    (Story) => (
      <View className="relative h-40 w-60">
        <Story />
      </View>
    ),
  ],
  beforeEach: [
    () => seed(useEditStore, { entityId: "shape-1", kind: "freeform" }),
    () => seed(useMapEngineStore, { pointerType: "touch" }),
  ],
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Drag a handle or hold a segment to add a point")).toBeVisible();
  },
};
