import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { runningVideoService, startingFeed } from "../../storybook/cameras";
import { missionPack } from "../../storybook/entities";
import { seed, seedEntities } from "../../storybook/seed";
import { MissionDoneFooter } from "./mission-health";
import { useMissionHealthStore } from "./mission-health-store";

const meta = {
  title: "Core/Mission pack/MissionDoneFooter",
  component: MissionDoneFooter,
  tags: ["!autodocs"],
  args: { onDone: fn() },
  beforeEach: [
    () => seed(useMissionHealthStore, { mission: missionPack() }),
    () => seedEntities(runningVideoService, { isConnected: true }),
  ],
  decorators: [
    (Story) => (
      <View className="w-[560px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof MissionDoneFooter>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Done")).toBeVisible();
  },
};

export const ProceedAnyway: Story = {
  beforeEach: () => seedEntities([...runningVideoService, startingFeed], { isConnected: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Proceed anyway")).toBeVisible();
    await expect(canvas.queryByText("Done")).toBeNull();
  },
};

export const NoMission: Story = {
  beforeEach: () => seed(useMissionHealthStore, { mission: null }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Done")).toBeNull();
  },
};

export const Pressed: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Done"));
    await expect(args.onDone).toHaveBeenCalledOnce();
  },
};
