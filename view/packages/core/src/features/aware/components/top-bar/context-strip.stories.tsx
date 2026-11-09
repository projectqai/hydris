import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect } from "storybook/test";

import { localClock, STORY_NOW } from "../../../../storybook/clock";
import { readyAsset } from "../../../../storybook/entities";
import { seedEntities } from "../../../../storybook/seed";
import { ContextStrip } from "./context-strip";

function toMinute(label: string) {
  return (name: string) => name.slice(0, -2) === label.slice(0, -2);
}

const meta = {
  title: "Core/Aware/Top bar/ContextStrip",
  component: ContextStrip,
  tags: ["!autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ContextStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => seedEntities([readyAsset("radar-1")], { isConnected: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Connected" })).toBeVisible();
    await expect(
      canvas.getByRole("group", { name: toMinute(`Local time ${localClock(STORY_NOW)}`) }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("group", {
        name: toMinute(`Zulu time ${new Date(STORY_NOW).toISOString().slice(11, 19)}`),
      }),
    ).toBeVisible();
    await expect(
      canvas.getByText(
        new Date(STORY_NOW)
          .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
          .toUpperCase(),
      ),
    ).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export const Connecting: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Connecting" })).toBeVisible();
  },
};

export const Disconnected: Story = {
  beforeEach: () =>
    seedEntities([], { isConnected: false, error: new Error("Engine unreachable") }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Disconnected" })).toBeVisible();
  },
};
