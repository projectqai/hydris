import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Blocks, Plus } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { localClock, STORY_NOW } from "../../../storybook/clock";
import { MissionTile } from "./mission-tile";

const STARTS_AT = STORY_NOW + 10 * 60 * 1000;

const meta = {
  title: "Core/Mission/MissionTile",
  component: MissionTile,
  args: { icon: Plus, label: "Add camera", variant: "empty", onPress: fn(), highlighted: false },
  argTypes: {
    icon: { control: false },
    state: { control: false },
    variant: {
      control: "select",
      options: ["empty", "default", "success", "info", "pending", "alert"],
    },
  },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <View className="w-[270px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof MissionTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add camera" }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const Highlighted: Story = { args: { highlighted: true } };

export const Scheduled: Story = {
  args: {
    title: "Other services",
    icon: Blocks,
    label: "Other services",
    variant: undefined,
    state: { variant: "success", label: "Scheduled", scheduledAt: timestampFromMs(STARTS_AT) },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(`Scheduled · ${localClock(STARTS_AT)}`)).toBeVisible();
  },
};

export const Pending: Story = {
  args: {
    title: "Other services",
    icon: Blocks,
    label: "Other services",
    variant: undefined,
    state: { variant: "pending", label: "Starting" },
  },
};
