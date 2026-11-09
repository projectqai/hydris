import { wholeText } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Eye, SunMoon } from "lucide-react-native";
import { expect, fn, userEvent } from "storybook/test";

import { command } from "../../../../../storybook/commands";
import { paletteView } from "../../../../../storybook/palette-view";
import type { Command } from "../command-registry";
import { CommandGroupView } from "./command-group-view";

function overlay(id: string, label: string): Command {
  return { id, label, icon: Eye, category: "overlay", action: fn() };
}

const commands: Command[] = [
  overlay("overlay-coverage", "Toggle coverage area"),
  overlay("overlay-detections", "Toggle detections"),
  overlay("overlay-shapes", "Toggle geoshapes"),
  overlay("overlay-track-history", "Toggle track history"),
  {
    id: "display-dark-theme",
    label: "Switch to dark theme",
    icon: SunMoon,
    category: "display",
    action: fn(),
  },
];

const meta = {
  title: "Core/Aware/Command palette/Views/CommandGroupView",
  component: CommandGroupView,
  argTypes: { commands: { control: false } },
  args: { groupId: "overlay", query: "", commands, onClose: fn() },
  decorators: [paletteView({ height: "h-80" })],
} satisfies Meta<typeof CommandGroupView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Toggle track history")).toBeVisible();
    await expect(canvas.queryByText("Switch to dark theme")).toBeNull();
  },
};

export const Filtered: Story = {
  args: { query: "track" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(wholeText("Toggle track history"))).toBeVisible();
    await expect(canvas.queryByText(wholeText("Toggle geoshapes"))).toBeNull();
  },
};

export const NoResults: Story = {
  args: { query: "sonar" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No results found")).toBeVisible();
  },
};

export const RunsOnPress: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Toggle detections"));
    await expect(command(args.commands, "overlay-detections").action).toHaveBeenCalledOnce();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const RunsWithKeyboard: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");
    await expect(command(args.commands, "overlay-detections").action).toHaveBeenCalledOnce();
    await expect(command(args.commands, "overlay-coverage").action).not.toHaveBeenCalled();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const SuggestedCommand: Story = {
  args: { initialCommandId: "overlay-shapes" },
  play: async ({ args }) => {
    await userEvent.keyboard("{Enter}");
    await expect(command(args.commands, "overlay-shapes").action).toHaveBeenCalledOnce();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
