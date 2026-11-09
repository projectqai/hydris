import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { entity } from "../../../../storybook/entities";
import { LocationTab } from "./location-tab";

const meta = {
  title: "Core/Aware/Entity details/LocationTab",
  component: LocationTab,
  argTypes: { entity: { control: false } },
  args: {
    entity: entity("det-1", {
      bearing: { azimuth: 37.25, elevation: -4.5 },
      geo: {
        latitude: 52.52,
        longitude: 13.4,
        covariance: { mxx: 4.2, mxy: 0.31, mxz: 0, myy: 3.125, myz: -0.04, mzz: 9.8 },
      },
    }),
  },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof LocationTab>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("37.3°")).toBeVisible();
    await expect(canvas.getByText("-4.5°")).toBeVisible();
    await expect(canvas.getByText("3.1250 m²")).toBeVisible();
    await expect(canvas.getByText("-0.0400 m²")).toBeVisible();
  },
};

export const BearingWithoutElevation: Story = {
  args: { entity: entity("det-2", { bearing: { azimuth: 212 } }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("212.0°")).toBeVisible();
    await expect(canvas.queryByText("Elevation")).toBeNull();
    await expect(canvas.queryByText("Position Covariance")).toBeNull();
  },
};

export const PartialCovarianceOnly: Story = {
  args: {
    entity: entity("trk-1", {
      geo: { latitude: 52.52, longitude: 13.4, covariance: { mxx: 12.5, myy: 8 } },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Bearing")).toBeNull();
    await expect(canvas.getByText("σ²xx")).toBeVisible();
    await expect(canvas.getByText("8.0000 m²")).toBeVisible();
    await expect(canvas.queryByText("σ²xy")).toBeNull();
  },
};
