import { pressable } from "@hydris/ui/storybook/queries";
import { DeviceState, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, userEvent, waitFor } from "storybook/test";

import { ago, localClock, STORY_NOW } from "../../../../storybook/clock";
import { asset, detection, entity, readyAsset } from "../../../../storybook/entities";
import { seed, seedEntities } from "../../../../storybook/seed";
import { useSelectionStore } from "../../store/selection-store";
import { ContactReportsPane } from "./contact-reports-pane";

const reports = [
  asset("radar-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
    label: "Radar North",
  }),
  detection("det-1", "radar-1", {
    detection: { detectorEntityId: "radar-1", classification: "drone" },
    classification: {
      taxonomy: [
        { kind: { case: "vehicle", value: { unmanned: {}, domain: { case: "air", value: {} } } } },
      ],
    },
    bearing: { azimuth: 212.4 },
  }),
  detection("det-2", "radar-1", { label: "Contact ALPHA" }),
  detection("det-3", "cam-9", {
    detection: { detectorEntityId: "cam-9", classification: "helicopter" },
    label: "Contact BRAVO from a sensor that is no longer reporting",
    bearing: undefined,
  }),
];

const UAV_TAIL = "· Air";

const meta = {
  title: "Core/Aware/Panes/ContactReportsPane",
  component: ContactReportsPane,
  tags: ["!autodocs"],
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-96 w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ContactReportsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => seedEntities(reports),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Vehicle · Unmanned")).toBeVisible();
    await expect(canvas.getByText(UAV_TAIL)).toBeVisible();
    await expect(canvas.queryByText(/drone/i)).toBeNull();
    await expect(canvas.getByText("helicopter")).toBeVisible();
    await expect(canvas.getByText("212°")).toBeVisible();
    await expect(canvas.getAllByText("Radar North")).toHaveLength(2);
    await expect(canvas.getByText("3")).toBeVisible();
  },
};

export const Empty: Story = {
  beforeEach: () => seedEntities([readyAsset("radar-1")]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No contact reports")).toBeVisible();
    await expect(canvas.getByText("0")).toBeVisible();
  },
};

export const Selected: Story = {
  beforeEach: [
    () => seedEntities(reports),
    () => seed(useSelectionStore, { selectedEntityId: "det-2" }),
  ],
  play: async ({ canvas }) => {
    await expect(pressable(await canvas.findByText("Contact ALPHA"))).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(pressable(canvas.getByText(UAV_TAIL))).toHaveAttribute("aria-pressed", "false");
  },
};

export const SelectsAndDeselects: Story = {
  beforeEach: () => seedEntities(reports),
  play: async ({ canvas }) => {
    const uav = pressable(await canvas.findByText(UAV_TAIL));

    await expect(uav).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(uav);
    await waitFor(() => expect(uav).toHaveAttribute("aria-pressed", "true"));

    await userEvent.click(uav);
    await waitFor(() => expect(uav).toHaveAttribute("aria-pressed", "false"));
  },
};

export const WithoutSourceBearingOrTime: Story = {
  beforeEach: () => seedEntities([entity("det-4", { detection: {}, label: "Contact CHARLIE" })]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Contact CHARLIE")).toBeVisible();
    await expect(canvas.getByText("--:--:--")).toBeVisible();
    await expect(canvas.queryByText(/°$/)).toBeNull();
  },
};

const updated = detection("det-7", "radar-1", {
  label: "Contact DELTA",
  lifetime: { from: ago(600), fresh: ago(30) },
});

const legacyProducer = detection("det-8", "radar-1", {
  label: "Contact ECHO",
  detection: { detectorEntityId: "radar-1", lastMeasured: ago(95) },
  lifetime: { from: ago(900), fresh: ago(900) },
});

export const ShowsLastSeen: Story = {
  beforeEach: () => seedEntities([updated, legacyProducer]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(localClock(STORY_NOW - 30_000))).toBeVisible();
    await expect(canvas.queryByText(localClock(STORY_NOW - 600_000))).toBeNull();
    await expect(canvas.getByText(localClock(STORY_NOW - 95_000))).toBeVisible();
    await expect(canvas.queryByText(localClock(STORY_NOW - 900_000))).toBeNull();
  },
};
