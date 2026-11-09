import { marker, pressable, wholeText } from "@hydris/ui/storybook/queries";
import { DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Activity, Video } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { asset } from "../../../../storybook/entities";
import { coreProviders } from "../../../../storybook/providers";
import { EntityPickerList } from "./entity-picker-list";

const cameras = [
  {
    id: "cam-1",
    name: "Gate north",
    entity: asset("cam-1", DeviceState.DeviceStateActive),
    subtitle: "RTSP · 1080p",
  },
  { id: "cam-2", name: "Hangar east", entity: asset("cam-2", DeviceState.DeviceStateFailed) },
  {
    id: "cam-3",
    name: "North ridge thermal",
    entity: asset("cam-3", DeviceState.DeviceStateActive),
  },
];

const meta = {
  title: "Core/Aware/Layout/EntityPickerList",
  component: EntityPickerList,
  args: {
    entities: cameras,
    icon: Video,
    itemsLabel: "cameras",
    placeholder: "Search cameras…",
    selectable: true,
    onSelect: fn(),
  },
  argTypes: {
    icon: {
      control: "select",
      options: ["Video", "Activity"],
      mapping: { Video, Activity },
    },
  },
  decorators: [
    (Story) => (
      <View className="w-[480px]">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof EntityPickerList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("RTSP · 1080p")).toBeVisible();
    await expect(canvas.getAllByText("Active")).toHaveLength(2);
    await expect(canvas.getAllByText("Failed")).toHaveLength(1);
  },
};

export const Pinned: Story = {
  args: { selectedId: "cam-2", followsId: "cam-1" },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(marker(canvas.getByText("Hangar east"), "Pinned")).toBeVisible();
    await expect(canvas.queryByLabelText("Following", { selector: "svg" })).toBeNull();
  },
};

export const FollowingMapSelection: Story = {
  args: { followsId: "cam-3" },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(marker(canvas.getByText("North ridge thermal"), "Following")).toBeVisible();
  },
};

export const NotSelectable: Story = {
  args: { selectable: false, selectedId: "cam-2", followsId: "cam-1" },
  play: async ({ canvas }) => {
    for (const camera of cameras) {
      await expect(pressable(canvas.getByText(camera.name)).querySelectorAll("svg")).toHaveLength(
        1,
      );
    }

    await expect(canvas.queryByLabelText("Pinned", { selector: "svg" })).toBeNull();
  },
};

export const Empty: Story = {
  args: { entities: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No cameras available")).toBeVisible();
  },
};

export const Filters: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search cameras…" }), "north");

    await expect(canvas.getByText(wholeText("North ridge thermal"))).toBeVisible();
    await expect(canvas.queryByText("Hangar east")).toBeNull();
  },
};

export const NoMatches: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search cameras…" }), "zzz");
    await expect(canvas.getByText("No matches found")).toBeVisible();
  },
};

export const SelectsOnPress: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Hangar east"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith("cam-2");
  },
};

export const SelectsWithKeyboard: Story = {
  play: async ({ args, canvas }) => {
    const gate = pressable(canvas.getByText("Gate north"));
    const hangar = pressable(canvas.getByText("Hangar east"));

    await waitFor(() => expect(gate).toHaveAttribute("aria-selected", "true"));

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    await waitFor(() => expect(hangar).toHaveAttribute("aria-selected", "true"));
    await expect(gate).toHaveAttribute("aria-selected", "false");

    await userEvent.keyboard("{Enter}");
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith("cam-2");
  },
};

export const AutoFocus: Story = {
  args: { autoFocus: true },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByRole("textbox", { name: "Search cameras…" })).toHaveFocus(),
    );
  },
};
