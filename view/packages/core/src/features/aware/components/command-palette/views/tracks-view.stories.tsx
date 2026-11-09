import { ClassificationIdentity } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";

import { readyAsset, track } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { TracksView } from "./tracks-view";

const meta = {
  title: "Core/Aware/Command palette/Views/TracksView",
  component: TracksView,
  tags: ["!autodocs"],
  args: { query: "", onClose: fn() },
  beforeEach: () =>
    seedEntities([
      track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, { label: "TANGO 21" }),
      track("trk-2", ClassificationIdentity.ClassificationIdentityFriend, { label: "BLUE 4" }),
      readyAsset("radar-1"),
    ]),
  decorators: [paletteView()],
} satisfies Meta<typeof TracksView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoTracks: Story = {
  beforeEach: () => seedEntities([readyAsset("radar-1")]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No tracks detected")).toBeVisible();
  },
};

export const SearchMatchesNothing: Story = {
  args: { query: "zulu" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No results found")).toBeVisible();
  },
};
