import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, mocked, userEvent } from "storybook/test";

import { searchLocations } from "../../../../../lib/location-search";
import { paletteView } from "../../../../../storybook/palette-view";
import { LocationSearchView } from "./location-search-view";

const meta = {
  title: "Core/Aware/Command palette/Views/LocationSearchView",
  component: LocationSearchView,
  tags: ["!autodocs"],
  args: { query: "Ber", onClose: fn() },
  decorators: [paletteView({ height: "h-80" })],
} satisfies Meta<typeof LocationSearchView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Bergen")).toBeVisible();
    await expect(canvas.getByText("Bern-Mittelland, Switzerland")).toBeVisible();
    await expect(canvas.getByText("3 results")).toBeInTheDocument();
  },
};

export const EmptyQuery: Story = {
  args: { query: "" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Search for a location")).toBeVisible();
  },
};

export const Searching: Story = {
  beforeEach: () => {
    mocked(searchLocations).mockReturnValue(new Promise(() => {}));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("progressbar", { name: "Searching" })).toBeVisible();
  },
};

export const NoResults: Story = {
  args: { query: "Lisbon" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No results found")).toBeVisible();
  },
};

export const SearchFailed: Story = {
  beforeEach: () => {
    mocked(searchLocations).mockRejectedValue(new Error("searchLocations called from a story"));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Search failed")).toBeVisible();
  },
};

export const ClosesOnPlacePress: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(await canvas.findByText("Bern"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
