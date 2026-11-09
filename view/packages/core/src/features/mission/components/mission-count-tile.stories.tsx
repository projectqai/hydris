import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Radar } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import type { CategoryState } from "../provider-state";
import { MissionCountTile } from "./mission-count-tile";
import { MissionTileCount } from "./mission-tile-count";

const running: CategoryState = {
  variant: "success",
  label: "Active",
  entityId: "webcam.service",
  services: 2,
  devices: 4,
};

const meta = {
  title: "Core/Mission/MissionCountTile",
  component: MissionCountTile,
  args: {
    title: "Sources",
    icon: Radar,
    state: undefined,
    emptyLabel: "Add sources",
    emptyVariant: "empty",
    onPress: fn(),
    highlighted: false,
    children: <MissionTileCount value={running.devices} label="Devices" />,
  },
  argTypes: {
    icon: { control: false },
    state: { control: false },
    children: { control: false },
    emptyVariant: { control: "select", options: ["empty"] },
  },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <View className="w-[270px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof MissionCountTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Sources/ }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const Pending: Story = {
  args: { state: { ...running, variant: "pending", label: "Starting" } },
};

export const Inactive: Story = {
  args: { state: { ...running, variant: "default", label: "Inactive" } },
};

export const Highlighted: Story = { args: { state: running, highlighted: true } };
