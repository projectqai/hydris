import { pressable } from "@hydris/ui/storybook/queries";
import {
  ClassificationIdentity,
  DeviceState,
  LinkStatus,
  SortField,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { asset, readyAsset, track } from "../../storybook/entities";
import { coreProviders } from "../../storybook/providers";
import { seed, seedEntities } from "../../storybook/seed";
import { LeftPanelContent } from "./left-panel-content";
import { useLeftPanelStore } from "./store/left-panel-store";
import { useSelectionStore } from "./store/selection-store";

const fleet = [
  track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, {
    label: "TANGO 21",
    geo: { latitude: 52.5309, longitude: 13.3847, altitude: 120 },
  }),
  track("trk-2", ClassificationIdentity.ClassificationIdentityFriend, {
    label: "BLUE 4",
    geo: { latitude: 52.51, longitude: 13.41, altitude: 900 },
  }),
  track("trk-3", ClassificationIdentity.ClassificationIdentityNeutral, {
    label: "Ferry Aurora",
    geo: { latitude: 52.49, longitude: 13.45, altitude: 2 },
  }),
  readyAsset("radar-1"),
  asset("cam-1", DeviceState.DeviceStateFailed, LinkStatus.LinkStatusLost),
];

function cardNames(getByText: (name: string) => HTMLElement) {
  return ["TANGO 21", "BLUE 4", "Ferry Aurora"]
    .map((name) => getByText(name))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .map((element) => element.textContent);
}

const altitudeDescending = () =>
  seed(useLeftPanelStore, { sort: { field: SortField.SortFieldGeoAltitude, descending: true } });

const meta = {
  title: "Core/Aware/LeftPanelContent",
  component: LeftPanelContent,
  tags: ["!autodocs"],
  beforeEach: () => seedEntities(fleet),
  parameters: { a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-[560px] w-80">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof LeftPanelContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("TANGO 21")).toBeVisible();
    await expect(canvas.getByText("Sort")).toBeVisible();
    await expect(cardNames(canvas.getByText)).toEqual(["BLUE 4", "Ferry Aurora", "TANGO 21"]);
  },
};

export const Assets: Story = {
  beforeEach: () => seed(useLeftPanelStore, { listMode: "assets" }),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("radar-1")).toBeVisible();
    await expect(canvas.getByText("cam-1")).toBeVisible();
    await expect(canvas.queryByText("TANGO 21")).toBeNull();
  },
};

export const NoTracks: Story = {
  beforeEach: () => seedEntities([readyAsset("radar-1")]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No tracks detected")).toBeVisible();
  },
};

export const NoAssets: Story = {
  beforeEach: [
    () => seed(useLeftPanelStore, { listMode: "assets" }),
    () => seedEntities(fleet.slice(0, 3)),
  ],
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No assets available")).toBeVisible();
  },
};

export const SortedByAltitude: Story = {
  beforeEach: altitudeDescending,
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Altitude")).toBeVisible();
    await expect(cardNames(canvas.getByText)).toEqual(["BLUE 4", "TANGO 21", "Ferry Aurora"]);
  },
};

export const ReversesSort: Story = {
  beforeEach: altitudeDescending,
  play: async ({ canvas, step }) => {
    await step("tracks start highest first", async () => {
      await canvas.findByText("Ferry Aurora");
      await expect(cardNames(canvas.getByText)).toEqual(["BLUE 4", "TANGO 21", "Ferry Aurora"]);
    });

    await step("choosing Altitude again puts the lowest first", async () => {
      await userEvent.click(canvas.getByText("Altitude"));
      await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Altitude" }));
      await waitFor(() =>
        expect(cardNames(canvas.getByText)).toEqual(["Ferry Aurora", "TANGO 21", "BLUE 4"]),
      );
    });

    await step("choosing it a third time restores highest first", async () => {
      await userEvent.click(canvas.getByText("Altitude"));
      await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Altitude" }));
      await waitFor(() =>
        expect(cardNames(canvas.getByText)).toEqual(["BLUE 4", "TANGO 21", "Ferry Aurora"]),
      );
    });
  },
};

export const SelectsOnPress: Story = {
  play: async ({ canvas }) => {
    const hostile = pressable(await canvas.findByText("TANGO 21"));

    await expect(hostile).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(hostile);
    await waitFor(() => expect(hostile).toHaveAttribute("aria-pressed", "true"));
    await expect(pressable(canvas.getByText("BLUE 4"))).toHaveAttribute("aria-pressed", "false");
  },
};

export const DeselectsOnSecondPress: Story = {
  beforeEach: () => seed(useSelectionStore, { selectedEntityId: "trk-1" }),
  play: async ({ canvas }) => {
    const hostile = pressable(await canvas.findByText("TANGO 21"));

    await expect(hostile).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(hostile);
    await waitFor(() => expect(hostile).toHaveAttribute("aria-pressed", "false"));
  },
};

export const SwitchesToAssets: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByText("Assets"));
    await expect(await canvas.findByText("radar-1")).toBeVisible();
  },
};

export const SortsFromMenu: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByText("Sort"));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Altitude" }));

    await waitFor(() =>
      expect(cardNames(canvas.getByText)).toEqual(["Ferry Aurora", "TANGO 21", "BLUE 4"]),
    );
    await expect(canvas.getByText("Altitude")).toBeVisible();
  },
};
