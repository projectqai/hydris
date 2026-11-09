import { cn } from "@hydris/ui/lib/utils";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { seed, seedEntities } from "../../storybook/seed";
import { MapAttribution } from "./map-search";
import { useMapStore } from "./store/map-store";

const meta = {
  title: "Core/Aware/MapAttribution",
  component: MapAttribution,
  tags: ["!autodocs"],
  decorators: [
    (Story, { parameters }) => (
      <View className={cn("h-24 w-[480px]", parameters.mapColor)}>
        <Story />
      </View>
    ),
  ],
  parameters: { mapColor: "bg-[#1c2a1f]", a11y: { test: "todo" } },
} satisfies Meta<typeof MapAttribution>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^MapLibre \| /)).toHaveTextContent(/Esri/);
  },
};

export const Street: Story = {
  beforeEach: () => seed(useMapStore, { layer: "street" }),
  parameters: { mapColor: "bg-[#f2efe9]" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^MapLibre \| /)).toHaveTextContent(/OpenStreetMap/);
  },
};

export const Dark: Story = {
  beforeEach: () => seed(useMapStore, { layer: "dark" }),
  parameters: { mapColor: "bg-[#0e0e0e]" },
};

export const WithVersion: Story = {
  beforeEach: () => seedEntities([], { hydrisVersion: "1.8.2" }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^v1\.8\.2 · INSECURE \| MapLibre \| /)).toBeVisible();
  },
};

export const UpdateAvailable: Story = {
  beforeEach: () => seedEntities([], { hydrisVersion: "v1.8.2", hydrisUpdateAvailable: "1.9.0" }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^v1\.8\.2 ↑ v1\.9\.0 · INSECURE \| MapLibre \| /)).toBeVisible();
  },
};
