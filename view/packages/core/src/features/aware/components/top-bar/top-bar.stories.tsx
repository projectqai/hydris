import { DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { makeMutable } from "react-native-reanimated";
import { expect, fn, userEvent } from "storybook/test";

import { asset, readyAsset } from "../../../../storybook/entities";
import { paletteOpener } from "../../../../storybook/providers";
import { seedEntities } from "../../../../storybook/seed";
import type { PaletteContextValue } from "../../palette-context";
import { BullseyeBarContent } from "./bullseye-bar-content";
import { TopBar } from "./top-bar";

type Args = ComponentProps<typeof TopBar> & {
  onCancelMode: () => void;
  onOpenPalette: PaletteContextValue["open"];
};

const closed = makeMutable(0);
const opened = makeMutable(1);

const meta = {
  title: "Core/Aware/Top bar/TopBar",
  component: TopBar,
  tags: ["!autodocs"],
  args: {
    activePresetId: "watch",
    onPresetSelect: fn(),
    customizeProgress: closed,
    isCustomizing: false,
    onCustomize: fn(),
    onDone: fn(),
    isLayoutModified: false,
    onResetToPreset: fn(),
    isScreenLocked: false,
    mode: null,
    onCancelMode: fn(),
    onOpenPalette: fn(),
  },
  argTypes: {
    customizeProgress: {
      control: "select",
      options: ["Closed", "Open"],
      mapping: { Closed: closed, Open: opened },
    },
    mode: { control: false },
  },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-80 self-stretch">
        <Story />
      </View>
    ),
    paletteOpener(),
  ],
  beforeEach: () =>
    seedEntities([readyAsset("radar-1"), asset("cam-1", DeviceState.DeviceStatePending)], {
      isConnected: true,
    }),
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Connected" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /asset/i })).toBeNull();
  },
};

export const Customizes: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Layout menu/ }));
    await userEvent.click(await canvas.findByLabelText("Customize layout"));
    await expect(args.onCustomize).toHaveBeenCalledOnce();
  },
};

export const CommandButtonRight: Story = { args: { commandButtonRight: true } };

export const ScreenLocked: Story = {
  args: { isScreenLocked: true },
  play: async ({ args, canvas, step }) => {
    await step("the layout menu does not respond", async () => {
      await expect(
        userEvent.click(canvas.getByRole("button", { name: /^Layout menu/ })),
      ).rejects.toThrow(/pointer-events: none/);
    });

    await step("Mission still opens the palette", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Mission" }));
      await expect(args.onOpenPalette).toHaveBeenCalledOnce();
    });
  },
};

export const Customizing: Story = {
  args: { customizeProgress: opened, isCustomizing: true },
  play: async ({ args, canvas, step }) => {
    await step("an unchanged layout shows editing without a reset", async () => {
      await expect(canvas.getByText("Editing Layout")).toBeVisible();
      await expect(canvas.queryByLabelText("Reset to preset")).toBeNull();
    });

    await step("a layout tab switches the preset", async () => {
      await userEvent.click(canvas.getByRole("tab", { name: "Switch to Survey layout" }));
      await expect(args.onPresetSelect).toHaveBeenCalledOnce();
      await expect(args.onPresetSelect).toHaveBeenCalledWith("survey");
    });

    await step("exit ends the editing", async () => {
      await userEvent.click(canvas.getByLabelText("Exit layout editing"));
      await expect(args.onDone).toHaveBeenCalledOnce();
    });
  },
};

export const CustomizingModified: Story = {
  args: { customizeProgress: opened, isCustomizing: true, isLayoutModified: true },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Reset to preset"));
    await expect(args.onResetToPreset).toHaveBeenCalledOnce();
  },
};

export const ModeBar: Story = {
  render: ({ onCancelMode, ...args }) => (
    <TopBar
      {...args}
      mode={{
        progress: opened,
        isActive: true,
        content: <BullseyeBarContent onCancel={onCancelMode} />,
      }}
    />
  ),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Cancel bullseye"));
    await expect(args.onCancelMode).toHaveBeenCalledOnce();
  },
};
