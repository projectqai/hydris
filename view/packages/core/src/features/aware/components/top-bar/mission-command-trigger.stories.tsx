import { ConfigurableState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { configDevice } from "../../../../storybook/entities";
import { paletteOpener } from "../../../../storybook/providers";
import { seedEntities } from "../../../../storybook/seed";
import type { PaletteContextValue } from "../../palette-context";
import { MissionCommandTrigger } from "./mission-command-trigger";

type Args = { onOpenPalette: PaletteContextValue["open"] };

const meta = {
  title: "Core/Aware/Top bar/MissionCommandTrigger",
  component: MissionCommandTrigger,
  tags: ["!autodocs"],
  args: { onOpenPalette: fn() },
  parameters: { layout: "centered" },
  decorators: [paletteOpener()],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () =>
    seedEntities([configDevice("relay.service", ConfigurableState.ConfigurableStateActive)]),
};

export const ServiceFailed: Story = {
  beforeEach: () =>
    seedEntities([
      configDevice("relay.service", ConfigurableState.ConfigurableStateStarting),
      configDevice("tracker.service", ConfigurableState.ConfigurableStateFailed),
    ]),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Mission Failed" }));
    await expect(args.onOpenPalette).toHaveBeenCalledOnce();
    await expect(args.onOpenPalette).toHaveBeenCalledWith();
  },
};
