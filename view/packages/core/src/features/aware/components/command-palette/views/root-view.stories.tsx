import { CATEGORY_IDS } from "@hydris/ui/command-palette/palette-reducer";
import { expectFillGrows, expectFillShrinks } from "@hydris/ui/storybook/hold-fill";
import { wholeText } from "@hydris/ui/storybook/queries";
import { ClassificationIdentity, ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Eye, Layout, Pencil, RotateCcw, Settings, SunMoon, Upload } from "lucide-react-native";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { command } from "../../../../../storybook/commands";
import {
  asset,
  camera,
  configDevice,
  equipmentAsset,
  track,
  webrtc,
} from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import type { Command } from "../command-registry";
import { MISSION_IMPORT_COMMAND_ID } from "../command-registry";
import { RootView } from "./root-view";

const commands: Command[] = [
  {
    id: "configuration",
    label: "Configuration",
    description: "Device and sensor settings",
    icon: Settings,
    category: "configuration",
    action: fn(),
    mode: { kind: "config" },
  },
  {
    id: "world-reset",
    label: "Reset world",
    description: "Delete every entity on this node",
    icon: RotateCcw,
    category: "world",
    action: fn(),
    holdToConfirm: true,
  },
  {
    id: "display-dark-theme",
    label: "Switch to dark theme",
    icon: SunMoon,
    category: "display",
    action: fn(),
  },
  {
    id: "layout-customize",
    label: "Customize layout",
    icon: Pencil,
    category: "layout",
    action: fn(),
  },
  { id: "overlay-shapes", label: "Toggle geoshapes", icon: Eye, category: "overlay", action: fn() },
  {
    id: "overlay-detections",
    label: "Toggle detections",
    icon: Eye,
    category: "overlay",
    action: fn(),
  },
  {
    id: "preset-watch",
    label: "Switch to Watch",
    icon: Layout,
    shortcut: "4",
    category: "preset",
    action: fn(),
  },
];

const entities = [
  equipmentAsset("radar-1", "Harbour radar"),
  equipmentAsset("radar-2", "North mast radar"),
  asset("gen-1", DeviceState.DeviceStateActive, undefined, { label: "Generator" }),
  camera("cam-1", [webrtc("Main", "/whep/cam-1")], { label: "Pier camera" }),
  track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, { label: "TANGO 21" }),
  track("trk-2", ClassificationIdentity.ClassificationIdentityFriend, { label: "EAGLE 04" }),
  configDevice("drv-1", ConfigurableState.ConfigurableStateActive, { label: "Radar driver" }),
];

const meta = {
  title: "Core/Aware/Command palette/Views/RootView",
  component: RootView,
  tags: ["!autodocs"],
  argTypes: {
    commands: { control: false },
    dispatch: { control: false },
    activeCategory: { control: "radio", options: CATEGORY_IDS },
  },
  args: {
    query: "",
    activeCategory: "commands",
    commands,
    dispatch: fn(),
    onClose: fn(),
  },
  beforeEach: () => seedEntities(entities),
  decorators: [paletteView()],
} satisfies Meta<typeof RootView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Toggle overlays")).toBeVisible();
    await expect(canvas.getByText("2")).toBeVisible();
    await expect(canvas.getByText("hold")).toBeVisible();
    await expect(canvas.getByText("4")).toBeVisible();
    await expect(canvas.queryByText("Toggle geoshapes")).toBeNull();
  },
};

export const MissionTab: Story = {
  args: {
    activeCategory: "mission",
    commands: [
      ...commands,
      {
        id: MISSION_IMPORT_COMMAND_ID,
        label: "Load mission pack",
        icon: Upload,
        category: "world",
        action: fn(),
      },
    ],
  },
  play: async ({ args, canvas, step }) => {
    await step("the tab shows the Sources, Assets, Tracks and Import tiles", async () => {
      const tiles = canvas.getAllByRole("button");

      await expect(tiles).toHaveLength(4);
      await expect(tiles[0]).toHaveAccessibleName(/^Sources/);
      await expect(tiles[1]).toHaveAccessibleName(/^Assets/);
      await expect(tiles[2]).toHaveAccessibleName(/^Tracks/);
      await expect(tiles[3]).toHaveAccessibleName("Import mission pack");
    });

    await step("the Assets tile opens Asset readiness", async () => {
      const assets = canvas.getByRole("button", { name: /^Assets/ });

      await expect(assets).toHaveTextContent(/^AssetsAsset readiness$/);
      await userEvent.click(assets);
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "asset-readiness" },
      });
    });

    await step("Import mission pack runs the import and closes the palette", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Import mission pack" }));
      await expect(command(args.commands, MISSION_IMPORT_COMMAND_ID).action).toHaveBeenCalledOnce();
      await expect(args.onClose).toHaveBeenCalledOnce();
    });
  },
};

export const MissionTabWithKeyboard: Story = {
  args: MissionTab.args,
  play: async ({ args, canvas, step }) => {
    await expect(canvas.getByText("Sources")).toBeVisible();

    const importPack = command(args.commands, MISSION_IMPORT_COMMAND_ID).action;

    await step("arrows reach Import mission pack and Enter runs it", async () => {
      await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}{Enter}");
      await expect(importPack).toHaveBeenCalledOnce();
    });

    await step("ArrowDown on the last row keeps the highlight on Import", async () => {
      await userEvent.keyboard("{ArrowDown}{Enter}");
      await expect(importPack).toHaveBeenCalledTimes(2);
      await expect(args.dispatch).not.toHaveBeenCalled();
    });

    await step("ArrowLeft moves to Tracks, then ArrowUp to Sources", async () => {
      await userEvent.keyboard("{ArrowLeft}{Enter}");
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "tracks" },
      });

      await userEvent.keyboard("{ArrowUp}{Enter}");
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "sources" },
      });
    });
  },
};

export const AssetsTab: Story = {
  args: { activeCategory: "assets" },
  play: async ({ args, canvas, step }) => {
    await step("the tab groups assets by dimension", async () => {
      await expect(canvas.getByText("Unclassified")).toBeVisible();
    });

    await step("a group opens its dimension", async () => {
      await userEvent.click(canvas.getByText("Equipment"));
      await expect(args.dispatch).toHaveBeenCalledOnce();
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: {
          kind: "dimension",
          dimension: "Equipment",
          dimensionLabel: "Equipment",
          category: "assets",
        },
      });
    });
  },
};

export const CamerasTab: Story = {
  args: { activeCategory: "cameras" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Cameras")).toBeVisible();
    await expect(canvas.getByText("Pier camera")).toBeVisible();
    await expect(canvas.queryByText("Harbour radar")).toBeNull();
  },
};

export const TracksTab: Story = {
  args: { activeCategory: "tracks" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("TANGO 21")).toBeVisible();
    await expect(canvas.getByText("EAGLE 04")).toBeVisible();
    await expect(canvas.queryByText("Tracks")).toBeNull();
  },
};

export const NoEntities: Story = {
  args: { activeCategory: "assets" },
  beforeEach: () => seedEntities([]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No entities found")).toBeVisible();
    await expect(canvas.getByText("Connect a data source to get started")).toBeVisible();
  },
};

export const Searching: Story = {
  args: { query: "radar" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Configurables")).toBeVisible();
    await expect(canvas.getByText(wholeText("North mast radar"))).toBeVisible();
    await expect(canvas.queryByText("Pier camera")).toBeNull();
  },
};

export const NoResults: Story = {
  args: { query: "sonar" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No results found")).toBeVisible();
  },
};

export const RunsCommand: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Switch to dark theme"));
    await expect(command(args.commands, "display-dark-theme").action).toHaveBeenCalledOnce();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const RunsWithKeyboard: Story = {
  play: async ({ args, canvas }) => {
    await canvas.findByText("Switch to dark theme");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await expect(command(args.commands, "display-dark-theme").action).toHaveBeenCalledOnce();
    await expect(command(args.commands, "world-reset").action).not.toHaveBeenCalled();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const OpensCommandMode: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Configuration"));
    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "config" },
    });
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

export const OpensCommandGroup: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Toggle overlays"));
    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "command-group", groupId: "overlay", groupLabel: "Overlays" },
    });
  },
};

export const OpensConfigurable: Story = {
  args: { query: "driver" },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText(wholeText("drv-1")));
    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "config", entityId: "drv-1" },
    });
  },
};

export const ClosesOnTrackPress: Story = {
  args: { activeCategory: "tracks" },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("EAGLE 04"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const HoldsToConfirm: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas, step }) => {
    const reset = command(args.commands, "world-reset").action;
    const user = userEvent.setup();

    await step("holding Enter counts down without running the command", async () => {
      await user.keyboard("{ArrowDown}{Enter>}");
      await expect(await canvas.findByText(/^1\.\ds$/)).toBeVisible();
      await expect(reset).not.toHaveBeenCalled();
    });

    await step("the command runs and the palette closes when the hold completes", async () => {
      await waitFor(() => expect(reset).toHaveBeenCalledOnce(), { timeout: 3_000 });
      await expect(args.onClose).toHaveBeenCalledOnce();
      await user.keyboard("{/Enter}");
    });
  },
};

export const HoldsToConfirmWithPointer: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    const reset = command(args.commands, "world-reset").action;
    const row = canvas.getByRole("button", { name: /Reset world/ });
    const user = userEvent.setup();

    await user.pointer({ keys: "[MouseLeft>]", target: row });
    await expectFillGrows(within(row).getByTestId("hold-fill"));
    await expect(await canvas.findByText(/^\d\.\ds$/)).toBeVisible();
    await expect(reset).not.toHaveBeenCalled();
    await waitFor(() => expect(reset).toHaveBeenCalledOnce(), { timeout: 3_000 });
    await expect(args.onClose).toHaveBeenCalledOnce();
    await user.pointer({ keys: "[/MouseLeft]", target: row });
  },
};

export const EarlyReleaseCancelsHold: Story = {
  play: async ({ args, canvas, step }) => {
    const reset = command(args.commands, "world-reset").action;
    const row = canvas.getByRole("button", { name: /Reset world/ });
    const user = userEvent.setup();

    await step("releasing the pointer early resets the hold", async () => {
      await user.pointer({ keys: "[MouseLeft>]", target: row });
      await expect(await canvas.findByText(/^1\.\ds$/)).toBeVisible();
      await user.pointer({ keys: "[/MouseLeft]", target: row });
      await expectFillShrinks(within(row).getByTestId("hold-fill"));
      await expect(await canvas.findByText("hold")).toBeVisible();
    });

    await step("releasing Enter early resets the hold", async () => {
      await user.keyboard("{ArrowDown}{Enter>}");
      await expect(await canvas.findByText(/^1\.\ds$/)).toBeVisible();
      await user.keyboard("{/Enter}");
      await expect(await canvas.findByText("hold")).toBeVisible();
    });

    await step("neither early release runs the command", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await expect(reset).not.toHaveBeenCalled();
      await expect(args.onClose).not.toHaveBeenCalled();
    });
  },
};

export const HeldEnterIgnoresUnhighlightedHoldRow: Story = {
  play: async ({ args, canvas }) => {
    const reset = command(args.commands, "world-reset").action;
    const user = userEvent.setup();

    await canvas.findByText("Reset world");
    await user.keyboard("{Enter>}");
    await expect(args.dispatch).toHaveBeenCalledWith({ type: "push", mode: { kind: "config" } });

    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await expect(reset).not.toHaveBeenCalled();
    await user.keyboard("{/Enter}");
  },
};
