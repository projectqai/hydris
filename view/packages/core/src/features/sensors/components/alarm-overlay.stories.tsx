import { shownDialog } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, mocked, screen, userEvent, waitFor } from "storybook/test";

import { worldClient } from "../../../lib/api/world-client";
import { alarm, DOSE_RATE } from "../../../storybook/alarms";
import { STORY_NOW } from "../../../storybook/clock";
import { entity } from "../../../storybook/entities";
import { coreProviders } from "../../../storybook/providers";
import { seedAlarms, seedEntities } from "../../../storybook/seed";
import { useAlarmAudio } from "../use-alarm-audio";
import { AlarmOverlay } from "./alarm-overlay";

function player() {
  const result = mocked(useAlarmAudio).mock.results[0];

  if (!result) throw new Error("The overlay never rendered");

  return result.value;
}

const meta = {
  title: "Core/Sensors/AlarmOverlay",
  component: AlarmOverlay,
  tags: ["!autodocs"],
  decorators: [coreProviders()],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AlarmOverlay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedAlarms([alarm("rad-north-1", DOSE_RATE)]),
  play: async () => {
    const dialog = await shownDialog();

    await expect(dialog.getByText("rad-north-1 sensor")).toBeVisible();
    await expect(player().play).toHaveBeenCalledOnce();
    await expect(player().pause).not.toHaveBeenCalled();
  },
};

export const NoAlarm: Story = {
  play: async () => {
    await expect(screen.queryByText("ACKNOWLEDGE")).toBeNull();
    await expect(player().play).not.toHaveBeenCalled();
  },
};

export const AcknowledgesOldestFirst: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: [
    () =>
      seedAlarms([
        alarm("rad-north-1", DOSE_RATE),
        { ...alarm("rad-south-2", DOSE_RATE), triggeredAt: STORY_NOW - 90_000 },
      ]),
    () =>
      seedEntities([entity("rad-south-2", { config: { value: { threshold: 3 }, version: 2n } })]),
  ],
  play: async () => {
    const dialog = await shownDialog();

    await expect(dialog.getByText("rad-south-2 sensor")).toBeVisible();

    await userEvent.click(dialog.getByText("ACKNOWLEDGE"));
    await expect(await dialog.findByText("rad-north-1 sensor")).toBeVisible();

    await expect(player().pause).not.toHaveBeenCalled();
    await expect(worldClient.push).toHaveBeenCalledWith({
      changes: [
        expect.objectContaining({
          id: "rad-south-2",
          config: expect.objectContaining({ value: { threshold: 3, cooldown: true }, version: 3n }),
        }),
      ],
    });

    await userEvent.click(dialog.getByText("ACKNOWLEDGE"));
    await waitFor(() => expect(screen.queryByText("ACKNOWLEDGE")).toBeNull());
    await expect(player().play).toHaveBeenCalledOnce();
    await expect(player().pause).toHaveBeenCalledOnce();
    await expect(worldClient.push).toHaveBeenCalledOnce();
  },
};
