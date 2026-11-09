import { ControlButton } from "@hydris/ui/controls";
import { backdropClose, marker } from "@hydris/ui/storybook/queries";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { ClassificationIdentity, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { DeviceModal } from "../../../../storybook/device-modal";
import {
  camera,
  chemicalSensor,
  entity,
  metric,
  radiationSensor,
  track,
  webrtc,
} from "../../../../storybook/entities";
import { coreProviders } from "../../../../storybook/providers";
import { seed, seedEntities } from "../../../../storybook/seed";
import { useSelectionStore } from "../../store/selection-store";
import { PaneEntityPickerModal } from "./pane-entity-picker-modal";

const stream = webrtc("Main", "/whep/main");

const heartRate = metric(MetricKind.MetricKindHeartRate, MetricUnit.MetricUnitUnspecified, 72);

const fleet = [
  camera("cam-1", [stream], {
    label: "Gate north",
    link: { status: LinkStatus.LinkStatusConnected },
  }),
  camera("cam-2", [stream], { label: "Hangar east" }),
  camera("cam-0", [], { label: "Decommissioned mast" }),
  track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, { label: "TANGO 21" }),
  radiationSensor("rad-1", 0.42, { label: "Dosimeter west" }),
  chemicalSensor("chem-1", [{ code: "CH1", value: 3, max: 8 }], { label: "Chem sniffer" }),
  entity("medic-1", { label: "Medic Alpha", metric: { metrics: [heartRate] } }),
];

type PaneEntityPickerModalPropsAndCustomArgs = ComponentProps<typeof PaneEntityPickerModal> & {
  open: boolean;
};

const meta = {
  title: "Core/Aware/Layout/PaneEntityPickerModal",
  component: PaneEntityPickerModal,
  tags: ["!autodocs"],
  args: {
    open: true,
    content: { type: "camera" },
    onSelect: fn(),
    onClear: fn(),
    onClose: fn(),
  },
  beforeEach: () => seedEntities(fleet),
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-screen">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
  render: function Render({ open, ...args }) {
    const [, updateArgs] = useArgs<PaneEntityPickerModalPropsAndCustomArgs>();

    if (!open) {
      return <ControlButton label="Open picker" onPress={() => updateArgs({ open: true })} />;
    }

    const close = () => {
      args.onClose();
      updateArgs({ open: false });
    };

    return (
      <DeviceModal onClose={close}>
        <PaneEntityPickerModal {...args} onClose={close} />
      </DeviceModal>
    );
  },
} satisfies Meta<PaneEntityPickerModalPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("dialog", { name: "Switch camera" })).toBeVisible();
    await expect(canvas.getByText("Gate north")).toBeVisible();
    await expect(canvas.getByText("Hangar east")).toBeVisible();
    await expect(canvas.queryByText("Decommissioned mast")).toBeNull();
    await expect(canvas.queryByText("TANGO 21")).toBeNull();
    await waitFor(() =>
      expect(canvas.getByRole("textbox", { name: "Search cameras…" })).toHaveFocus(),
    );
  },
};

export const PinnedCamera: Story = {
  args: { content: { type: "camera", entityId: "cam-2" } },
  play: async ({ canvas }) => {
    await expect(marker(canvas.getByText("Hangar east"), "Pinned")).toBeVisible();
  },
};

export const FollowsMapSelection: Story = {
  beforeEach: () => seed(useSelectionStore, { selectedEntityId: "cam-1" }),
  play: async ({ canvas }) => {
    await expect(marker(canvas.getByText("Gate north"), "Following")).toBeVisible();
  },
};

export const LevelsSensor: Story = {
  args: { content: { type: "sensor", widgetId: "sensor:levels" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("dialog", { name: "Switch sensor" })).toBeVisible();
    await expect(canvas.getByText("Chem sniffer")).toBeVisible();
    await expect(canvas.queryByText("Dosimeter west")).toBeNull();
  },
};

export const VitalsWidget: Story = {
  args: { content: { type: "component", componentId: "vitals" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("dialog", { name: "Show vitals from" })).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Search vitals…" })).toBeVisible();
    await expect(canvas.getByText("Medic Alpha")).toBeVisible();
  },
};

export const NoMatchingEntities: Story = {
  args: { content: { type: "component", componentId: "equipment" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No equipment available")).toBeVisible();
  },
};

export const Selects: Story = {
  args: { content: { type: "camera", entityId: "cam-1" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Hangar east"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith("cam-2");
    await expect(args.onClear).not.toHaveBeenCalled();
  },
};

export const ClearsPinned: Story = {
  args: { content: { type: "camera", entityId: "cam-1" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Gate north"));
    await expect(args.onClear).toHaveBeenCalledOnce();
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const ClosesFromButton: Story = {
  play: async ({ args, canvas }) => {
    const dialog = within(canvas.getByRole("dialog", { name: "Switch camera" }));

    await expect(canvas.getAllByLabelText("Close")).toHaveLength(2);
    await userEvent.click(dialog.getByLabelText("Close"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ClosesFromBackdrop: Story = {
  play: async ({ args, canvas }) => {
    const dialog = canvas.getByRole("dialog", { name: "Switch camera" });

    await expect(canvas.getAllByLabelText("Close")).toHaveLength(2);
    await userEvent.click(backdropClose(canvas, dialog));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
