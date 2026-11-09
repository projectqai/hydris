import { ControlButton } from "@hydris/ui/controls";
import { ClassificationIdentity, DeviceState, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { asset, detection, entity, track } from "../../storybook/entities";
import { coreProviders } from "../../storybook/providers";
import { seed, seedEntities } from "../../storybook/seed";
import { RightPanelContent } from "./right-panel-content";
import { useSelectionStore } from "./store/selection-store";
import { useTabStore } from "./store/tab-store";

const hostile = track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, {
  label: "TANGO 21",
});

const radar = entity("radar-1", { label: "Radar North" });
const contact = detection("det-1", "radar-1", { label: "Contact ALPHA", lifetime: undefined });

const camera = asset("cam-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected, {
  label: "Gate north",
  symbol: undefined,
});

const selected = (entityId: string) => seed(useSelectionStore, { selectedEntityId: entityId });

const meta = {
  title: "Core/Aware/RightPanelContent",
  component: RightPanelContent,
  tags: ["!autodocs"],
  argTypes: {
    headerActions: {
      control: "select",
      options: ["None", "Follow"],
      mapping: {
        None: undefined,
        Follow: (
          <ControlButton label="Follow" size="md" fullWidth onPress={fn().mockName("onFollow")} />
        ),
      },
    },
  },
  beforeEach: () => seedEntities([hostile, radar, contact, camera]),
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-[640px] w-80">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof RightPanelContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No entity selected")).toBeVisible();
  },
};

export const SelectedTrack: Story = {
  beforeEach: () => selected("trk-1"),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("TANGO 21")).toBeVisible();
    await expect(canvas.getByText("Red")).toBeVisible();
    await expect(canvas.getByText("Info")).toBeVisible();
    await expect(canvas.queryByText("Location")).toBeNull();
    await expect(canvas.getByText("Tracked By")).toBeVisible();
  },
};

export const SelectedDetection: Story = {
  beforeEach: () => selected("det-1"),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Location")).toBeVisible();
    await expect(canvas.queryByText("Info")).toBeNull();
  },
};

export const SelectedAsset: Story = {
  beforeEach: () => selected("cam-1"),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Gate north")).toBeVisible();
    await expect(canvas.queryByText("Location")).toBeNull();
    await expect(canvas.queryByText("Info")).toBeNull();
  },
};

export const WithHeaderActions: Story = {
  args: { headerActions: "Follow" },
  beforeEach: () => selected("trk-1"),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Follow")).toBeVisible();
  },
};

export const OpensStoredTab: Story = {
  beforeEach: [() => selected("trk-1"), () => seed(useTabStore, { initialTab: "components" })],
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Active Components (2)")).toBeVisible();
  },
};

export const SwitchesTab: Story = {
  beforeEach: () => selected("trk-1"),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Info"));
    await expect(canvas.getByText("MIL-STD-2525C")).toBeVisible();
  },
};
