import type { JsonObject } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { type PaletteState, paletteStateAt } from "@hydris/ui/command-palette/palette-reducer";
import { ControlButton } from "@hydris/ui/controls";
import type { LayoutNode } from "@hydris/ui/layout/types";
import type { Canvas } from "@hydris/ui/storybook/queries";
import { IGNORE_HIDDEN, pressable, wholeText } from "@hydris/ui/storybook/queries";
import {
  ClassificationIdentity,
  ConfigurableState,
  DeviceState,
  ExpireEntityResponseSchema,
  LinkStatus,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, mocked, screen, userEvent, waitFor, within } from "storybook/test";

import { worldClient } from "../../../../lib/api/world-client";
import {
  axisService,
  cameraAwaitingSetup,
  gateCamera,
  SERVICE_SCHEMA,
  simcamService,
} from "../../../../storybook/cameras";
import { withSchema } from "../../../../storybook/config";
import { DeviceModal } from "../../../../storybook/device-modal";
import type { EntityInit } from "../../../../storybook/entities";
import {
  asset,
  configDevice,
  entity,
  missionPack,
  notSetUpCameraService,
  readyAsset,
  taskable,
  track,
} from "../../../../storybook/entities";
import { coreProviders } from "../../../../storybook/providers";
import { acceptPushes } from "../../../../storybook/requests";
import { seed, seedEntities } from "../../../../storybook/seed";
import { useMissionHealthStore } from "../../../mission-pack/mission-health-store";
import { useMissionKitStore } from "../../store/mission-kit-store";
import { CommandPalette } from "./command-palette";

const entities = [
  readyAsset("radar-1"),
  asset("cam-1", DeviceState.DeviceStatePending, LinkStatus.LinkStatusConnected, {
    label: "Pier camera",
  }),
  track("trk-1", ClassificationIdentity.ClassificationIdentityHostile, { label: "TANGO 21" }),
];

const CAMERA_SCHEMA: JsonObject = {
  type: "object",
  properties: { host: { type: "string", title: "Host" } },
};

const cameraDebugger = [simcamService, gateCamera];

const axisCameraNeedingSetup = [
  withSchema(axisService(), SERVICE_SCHEMA),
  cameraAwaitingSetup(CAMERA_SCHEMA),
];

const secondAxisCameraNeedingSetup = cameraAwaitingSetup(CAMERA_SCHEMA, "10.0.4.18");

const tileLevels = [
  ...cameraDebugger,
  notSetUpCameraService("wildlife.service", "Wildlife cameras"),
  configDevice("radar.service", ConfigurableState.ConfigurableStateActive, {
    label: "Radar service",
  }),
];

const AXIS_PAGE = /^MissionSourcesElectro OpticalAXIS Cameras$/;

async function opened(canvas: Canvas) {
  await waitFor(() =>
    expect(canvas.getByRole("dialog", { name: "Command palette" })).toBeVisible(),
  );
}

function palettes(canvas: Canvas) {
  return canvas.getAllByRole("dialog", { hidden: true });
}

async function shows(canvas: Canvas, text: string) {
  await waitFor(() => expect(canvas.getByText(text)).toBeVisible());
}

async function showsTileKeys(canvas: Canvas) {
  await expect(canvas.getByText("↑↓←→")).toBeVisible();
  await expect(canvas.getByText("select")).toBeVisible();
}

async function openCommands(canvas: Canvas) {
  await shows(canvas, "Add sources");
  await userEvent.click(canvas.getByRole("tab", { name: "Commands" }));
  await shows(canvas, "Load mission pack");
}

async function run(canvas: Canvas, label: string) {
  await openCommands(canvas);

  for (let step = 0; step < 40 && !canvas.queryByText(label); step++) {
    await userEvent.keyboard("{ArrowDown}");
  }

  await userEvent.click(canvas.getByText(label));
}

function tile(canvas: Canvas, title: string) {
  return canvas.getByRole("button", { name: new RegExp(`^${title}(?! configuration$)`) });
}

async function openSources(canvas: Canvas) {
  await waitFor(() => expect(tile(canvas, "Sources")).toBeVisible());
  await userEvent.click(tile(canvas, "Sources"));
}

async function openService(canvas: Canvas, label: string) {
  await openSources(canvas);
  await userEvent.click(tile(canvas, "Electro Optical"));
  await userEvent.click(tile(canvas, label));
  await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
    new RegExp(`^MissionSourcesElectro Optical${label}$`),
  );
}

async function expectSelectedTab(canvas: Canvas, name: string) {
  await expect(canvas.getByRole("tab", { selected: true })).toHaveAccessibleName(name);
}

type CommandPalettePropsAndCustomArgs = ComponentProps<typeof CommandPalette> & { open: boolean };

const meta = {
  title: "Core/Aware/Command palette/CommandPalette",
  component: CommandPalette,
  tags: ["!autodocs"],
  argTypes: { layoutActions: { control: false } },
  args: {
    open: true,
    onClose: fn(),
    onReopen: fn(),
    layoutActions: {
      presetSelect: fn(),
      customize: fn(),
      resetLayout: fn(),
      shareView: fn(),
      saveCustomTree: fn(),
      clearCustomTree: fn(),
      toggleScreenLock: fn(() => true),
    },
  },
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  beforeEach: () => seedEntities(entities, { hydrisVersion: "1.8.2" }),
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-[720px] w-full">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
  render: function Render({ open, ...args }) {
    const [, updateArgs] = useArgs<CommandPalettePropsAndCustomArgs>();

    if (!open) {
      return <ControlButton label="Open palette" onPress={() => updateArgs({ open: true })} />;
    }

    const close = () => {
      args.onClose();
      updateArgs({ open: false });
    };

    const reopen = (state: PaletteState) => {
      args.onReopen(state);
      updateArgs({ open: true, initialState: state });
    };

    return (
      <DeviceModal onClose={close}>
        <CommandPalette {...args} onClose={close} onReopen={reopen} />
      </DeviceModal>
    );
  },
} satisfies Meta<CommandPalettePropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await shows(canvas, "Add sources");
    await expect(tile(canvas, "Assets")).toHaveTextContent(/^AssetsAsset readiness$/);
    await expect(canvas.getAllByRole("tab")[0]).toHaveAccessibleName("Mission");
    await expectSelectedTab(canvas, "Mission");
    await expect(canvas.queryByText("Load mission pack")).toBeNull();
    await expect(canvas.queryByText("TANGO 21")).toBeNull();
    await shows(canvas, "category");
    await shows(canvas, "v1.8.2 · INSECURE");
    await waitFor(() =>
      expect(canvas.getByPlaceholderText("Search entities, commands...")).toBeVisible(),
    );
  },
};

export const LocationSearch: Story = {
  args: { initialState: paletteStateAt({ kind: "location-search" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await expect(canvas.getByPlaceholderText("Search address or place...")).toBeVisible();
    await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent("MissionGo to location");
    await expect(canvas.getByText("go to")).toBeVisible();
    await expect(canvas.getByText("Search for a location")).toBeVisible();
  },
};

export const CommandGroup: Story = {
  args: {
    initialState: paletteStateAt({
      kind: "command-group",
      groupId: "overlay",
      groupLabel: "Overlays",
    }),
  },
  play: async ({ canvas }) => {
    await shows(canvas, "Toggle geoshapes");
    await shows(canvas, "toggle");
    await waitFor(() => expect(canvas.getByPlaceholderText("Search overlays...")).toBeVisible());
  },
};

async function showsAssetReadiness(canvas: Canvas, trail: RegExp) {
  await waitFor(() => expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(trail));
  await expect(canvas.getByPlaceholderText("Search assets...")).toBeVisible();
  await expect(canvas.getByText("Pier camera")).toBeVisible();
}

export const AssetReadiness: Story = {
  args: { initialState: paletteStateAt({ kind: "asset-readiness" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await showsAssetReadiness(canvas, /^MissionAsset readiness$/);
    await shows(canvas, "navigate");
  },
};

export const AssetsTileOpensAssetReadiness: Story = {
  play: async ({ canvas }) => {
    await shows(canvas, "Add sources");
    await userEvent.click(tile(canvas, "Assets"));
    await showsAssetReadiness(canvas, /^MissionAsset readiness$/);
  },
};

export const TracksTileOpensTracks: Story = {
  play: async ({ canvas }) => {
    await shows(canvas, "Add sources");
    await userEvent.click(tile(canvas, "Tracks"));
    await waitFor(() =>
      expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(/^MissionTracks$/),
    );
    await expect(canvas.getByPlaceholderText("Search tracks...")).toBeVisible();
    await expect(await canvas.findByText("TANGO 21")).toBeVisible();
    await expect(canvas.queryByText("Pier camera")).toBeNull();
  },
};

export const SearchFiltersAssets: Story = {
  args: { initialState: paletteStateAt({ kind: "asset-readiness" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await expect(canvas.getByText("Pier camera")).toBeVisible();

    await userEvent.type(canvas.getByRole("textbox", { name: "Search" }), "radar");
    await waitFor(() => expect(canvas.queryByText("Pier camera")).toBeNull());
    await expect(canvas.getByText("Ready")).toBeVisible();
  },
};

export const AssetOpensDetailAndBackReturns: Story = {
  args: { initialState: paletteStateAt({ kind: "asset-readiness" }) },
  play: async ({ canvas, step }) => {
    await opened(canvas);

    await step("pressing an asset opens its detail", async () => {
      await userEvent.click(canvas.getByText("Pier camera"));
      await shows(canvas, "Open Configuration");
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
        /^MissionAsset readinessPier camera$/,
      );
    });

    await step("Back returns to the list", async () => {
      await userEvent.click(canvas.getByLabelText("Go back"));
      await showsAssetReadiness(canvas, /^MissionAsset readiness$/);
      await expect(canvas.queryByText("Open Configuration")).toBeNull();
    });
  },
};

export const Configuration: Story = {
  args: { initialState: paletteStateAt({ kind: "config" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await expect(canvas.getByPlaceholderText("Search by id or name...")).toBeVisible();
    await expect(canvas.getByLabelText("Hide device list")).toBeVisible();
    await expect(canvas.getByText("Select a source to view its configuration")).toBeVisible();
  },
};

export const ConfigurationBadgesARunningFailure: Story = {
  args: { initialState: paletteStateAt({ kind: "config" }) },
  beforeEach: () =>
    seedEntities([
      ...entities,
      configDevice("cam-9", ConfigurableState.ConfigurableStateActive, {
        label: "Gate camera",
        device: { category: "Cameras", state: DeviceState.DeviceStateFailed },
      }),
    ]),
  play: async ({ canvas }) => {
    await opened(canvas);
    await userEvent.type(canvas.getByPlaceholderText("Search by id or name..."), "Gate");

    const row = pressable(await canvas.findByText(wholeText("Gate camera")));

    await expect(row).toHaveTextContent("Failed");
  },
};

export const ConfigurationControlsKeepEscape: Story = {
  args: { initialState: paletteStateAt({ kind: "config" }) },
  beforeEach: () =>
    seedEntities([
      ...entities,
      configDevice("radar-9", ConfigurableState.ConfigurableStateActive, { label: "Coast radar" }),
      taskable("radar-9.recalibrate", "Recalibrate", ["radar-9"]),
      entity("radar-9.scan", {
        taskable: {
          label: "Scan mode",
          assignee: [{ entityId: "radar-9" }],
          target: {
            mode: {
              active: "wide",
              options: [
                { id: "wide", label: "Wide" },
                { id: "narrow", label: "Narrow" },
              ],
            },
          },
        },
      }),
    ]),
  play: async ({ canvas, step }) => {
    const user = userEvent.setup();
    const search = canvas.getByPlaceholderText("Search by id or name...");

    await opened(canvas);
    await user.type(search, "Coast");
    await user.click(pressable(await canvas.findByText(wholeText("Coast radar"))));
    await user.clear(search);

    await step("Escape ends a mode switch waiting for its hold", async () => {
      await user.click(await canvas.findByRole("radio", { name: /^Wide/ }));
      await user.click(await canvas.findByRole("radio", { name: /^Narrow/ }));
      await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

      await user.keyboard("{Escape}");
      await waitFor(() => expect(canvas.queryByRole("radio", { name: /^Narrow/ })).toBeNull());
      await expect(canvas.getByRole("radiogroup", { name: "Scan mode" })).toBeVisible();
    });

    await step("Escape ends a task button waiting for its hold", async () => {
      await user.click(canvas.getByRole("button", { name: /^Recalibrate/ }));
      await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

      await user.keyboard("{Escape}");
      await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
      await expect(canvas.getByRole("button", { name: /^Recalibrate/ })).toBeVisible();
    });

    await step("arrows and Enter pick a mode in the open picker", async () => {
      await user.click(await canvas.findByRole("radio", { name: /^Wide/ }));

      const narrow = await canvas.findByRole("radio", { name: /^Narrow/ });

      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(narrow).toHaveFocus());

      await user.keyboard("{Enter}");
      await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);
      await expect(canvas.getByRole("radiogroup", { name: "Scan mode" })).toBeVisible();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(canvas.queryByRole("radio", { name: /^Narrow/ })).toBeNull());
    });

    await step("holding Enter from rest switches the mode", async () => {
      await user.click(await canvas.findByRole("radio", { name: /^Wide/ }));

      const narrow = await canvas.findByRole("radio", { name: /^Narrow/ });

      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(narrow).toHaveFocus());

      await user.keyboard("{Enter>}");
      await waitFor(() => expect(worldClient.runTask).toHaveBeenCalledOnce(), { timeout: 2_000 });
      await user.keyboard("{/Enter}");
    });
  },
};

export const MissionHealth: Story = {
  args: { initialState: paletteStateAt({ kind: "mission-health" }) },
  beforeEach: () => {
    seed(useMissionHealthStore, { mission: missionPack() });
    seedEntities([...entities, ...cameraDebugger], { isConnected: true });
  },
  play: async ({ args, canvas, step }) => {
    await opened(canvas);

    await step("the view opens with no search", async () => {
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent("MissionMission health");
      await expect(canvas.queryByRole("textbox", { name: "Search" })).toBeNull();
    });

    await step("Done closes the palette", async () => {
      await userEvent.click(canvas.getByText("Done"));
      await expect(args.onClose).toHaveBeenCalledOnce();
    });
  },
};

export const ReportBug: Story = {
  args: { initialState: paletteStateAt({ kind: "diagnostic-export" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await expect(canvas.getByText("Report a bug")).toBeVisible();
    await expect(canvas.getByText("Export diagnostic")).toBeVisible();
  },
};

export const ClosesFromBackdrop: Story = {
  play: async ({ args, canvas }) => {
    await shows(canvas, "Add sources");
    await userEvent.click(canvas.getByLabelText("Close command palette"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const SwitchesCategory: Story = {
  play: async ({ canvas }) => {
    await shows(canvas, "Add sources");
    await userEvent.click(canvas.getByRole("tab", { name: "Tracks" }));
    await shows(canvas, "TANGO 21");
    await expectSelectedTab(canvas, "Tracks");
    await expect(canvas.getByText("↑↓")).toBeVisible();
  },
};

export const SearchesFromMissionTab: Story = {
  play: async ({ canvas }) => {
    await shows(canvas, "Add sources");
    await userEvent.type(canvas.getByRole("textbox", { name: "Search" }), "Pier");
    await expect(await canvas.findByText(wholeText("Pier camera"))).toBeVisible();
    await expect(canvas.queryByText("Add sources")).toBeNull();
  },
};

export const OpensModeAndGoesBack: Story = {
  play: async ({ canvas, step }) => {
    await openCommands(canvas);

    await step("a mode command opens its mode", async () => {
      await userEvent.click(canvas.getByText("Configuration"));
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent("CommandsConfiguration");
    });

    await step("Go back returns to the Commands tab", async () => {
      await userEvent.click(canvas.getByLabelText("Go back"));
      await expectSelectedTab(canvas, "Commands");
    });
  },
};

export const ConfigurationButtonOpensConfiguration: Story = {
  play: async ({ canvas }) => {
    await shows(canvas, "Add sources");
    await userEvent.type(canvas.getByRole("textbox", { name: "Search" }), "Pier");
    await userEvent.click(canvas.getByRole("button", { name: "Configuration" }));
    await expect(
      await canvas.findByText("Select a source to view its configuration"),
    ).toBeVisible();
    await expect(canvas.getByPlaceholderText("Search by id or name...")).toBeVisible();
  },
};

export const TileLevelsOfferTileKeys: Story = {
  beforeEach: () => seedEntities(tileLevels),
  play: async ({ canvas, step }) => {
    await step("the Mission tab", async () => {
      await waitFor(() => expect(tile(canvas, "Sources")).toBeVisible());
      await showsTileKeys(canvas);
    });

    await step("Sources", async () => {
      await userEvent.click(tile(canvas, "Sources"));
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(/^MissionSources$/);
      await showsTileKeys(canvas);
    });

    await step("Other services", async () => {
      await userEvent.click(tile(canvas, "Other services"));
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
        /^MissionSourcesOther services$/,
      );
      await showsTileKeys(canvas);
      await userEvent.click(canvas.getByLabelText("Go back"));
    });

    await step("Electro Optical", async () => {
      await userEvent.click(tile(canvas, "Electro Optical"));
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
        /^MissionSourcesElectro Optical$/,
      );
      await showsTileKeys(canvas);
    });

    await step("a service page", async () => {
      await userEvent.click(tile(canvas, "Camera Debugger"));
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
        /^MissionSourcesElectro OpticalCamera Debugger$/,
      );
      await showsTileKeys(canvas);
    });
  },
};

export const CameraPageFooterOffersItsKeys: Story = {
  beforeEach: () => seedEntities(cameraDebugger),
  play: async ({ canvas, step }) => {
    await openService(canvas, "Camera Debugger");
    await userEvent.click(tile(canvas, "Gate camera"));

    await step("a set-up camera's page offers no keys", async () => {
      await expect(canvas.queryByText("navigate")).toBeNull();
      await expect(canvas.queryByText("select")).toBeNull();
    });

    await step("a camera awaiting setup offers navigate and select", async () => {
      seedEntities(
        cameraDebugger.map((e) => (e.id === "simcam-1" ? { ...e, config: undefined } : e)),
      );
      await shows(canvas, "navigate");
      await expect(canvas.getByText("↑↓")).toBeVisible();
      await expect(canvas.getByText("select")).toBeVisible();
    });
  },
};

export const SetupOpensOverThePalette: Story = {
  beforeEach: () => seedEntities(axisCameraNeedingSetup),
  play: async ({ canvas, step }) => {
    await openService(canvas, "AXIS Cameras");

    await step("the setup opens in its own window over the service page", async () => {
      await userEvent.click(tile(canvas, "AXIS Camera 10.0.4.17"));
      await waitFor(() => expect(canvas.getByRole("button", { name: "Close" })).toBeVisible());

      const setup = canvas.getByRole("dialog", { name: "Command palette" });
      const behind = palettes(canvas).find((palette) => palette !== setup);

      await expect(within(setup).queryByLabelText("Breadcrumb")).toBeNull();
      await expect(within(setup).queryByText("navigate")).toBeNull();
      await expect(within(behind!).getByLabelText("Breadcrumb")).toHaveTextContent(AXIS_PAGE);
    });

    await step("arrow keys and Enter do not reach the service page behind", async () => {
      await userEvent.keyboard("{ArrowRight}{Enter}");
      await expect(palettes(canvas)).toHaveLength(2);
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(AXIS_PAGE);
    });

    await step("Escape closes the setup window and returns to the service page", async () => {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(palettes(canvas)).toHaveLength(1));
      await expect(canvas.getByRole("dialog", { name: "Command palette" })).toBe(
        palettes(canvas)[0],
      );
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(AXIS_PAGE);
    });
  },
};

export const SetupOpenedWhileAnotherClosesStartsEmpty: Story = {
  beforeEach: () => seedEntities([...axisCameraNeedingSetup, secondAxisCameraNeedingSetup]),
  play: async ({ canvas, step }) => {
    await openService(canvas, "AXIS Cameras");
    await userEvent.click(tile(canvas, "AXIS Camera 10.0.4.17"));
    await userEvent.type(await canvas.findByLabelText("Host"), "10.0.4.17");

    await step("the second camera's setup does not keep the first one's draft", async () => {
      await userEvent.keyboard("{Escape}");
      await userEvent.click(tile(canvas, "AXIS Camera 10.0.4.18"));
      await waitFor(() => expect(canvas.getByText("axis.device.10_0_4_18")).toBeVisible());
      await expect(canvas.getByLabelText("Host")).toHaveValue("");
    });
  },
};

export const ShiftTabStaysInTheSetup: Story = {
  beforeEach: () => seedEntities(cameraDebugger),
  play: async ({ canvas, step }) => {
    await openService(canvas, "Camera Debugger");
    await userEvent.click(tile(canvas, "Gate camera"));
    seedEntities(
      cameraDebugger.map((e) =>
        e.id === "simcam-1" ? { ...withSchema(e, CAMERA_SCHEMA), config: undefined } : e,
      ),
    );
    await userEvent.click(await canvas.findByText("Set up camera"));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Close" })).toBeVisible());

    const setup = canvas.getByRole("dialog", { name: "Command palette" });

    await step("Shift+Tab does not reach the camera page behind", async () => {
      for (let press = 0; press < 3; press++) {
        await userEvent.tab({ shift: true });
        await expect(setup.contains(document.activeElement)).toBe(true);
      }
    });

    await step("closing the setup gives focus back to the camera page", async () => {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(palettes(canvas)).toHaveLength(1));
      await expect(canvas.getByRole("button", { name: "Config" })).toBeEnabled();
      await userEvent.tab({ shift: true });
      await expect(palettes(canvas)[0]!.contains(document.activeElement)).toBe(true);
    });
  },
};

export const BreadcrumbFollowsRenames: Story = {
  beforeEach: () => seedEntities(cameraDebugger),
  play: async ({ canvas }) => {
    await openService(canvas, "Camera Debugger");
    await userEvent.click(tile(canvas, "Gate camera"));

    seedEntities(
      cameraDebugger.map((e) => {
        if (e.id === "simcam.service") return { ...e, label: "Yard simulator" };

        return { ...e, label: "North gate camera" };
      }),
    );
    await waitFor(() =>
      expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
        /^MissionSourcesElectro OpticalYard simulatorNorth gate camera$/,
      ),
    );
  },
};

export const BreadcrumbGoesBack: Story = {
  args: { initialState: paletteStateAt({ kind: "location-search" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await userEvent.click(within(canvas.getByLabelText("Breadcrumb")).getByText("Mission"));
    await shows(canvas, "Add sources");
    await expect(canvas.queryByLabelText("Breadcrumb")).toBeNull();
  },
};

export const BackspaceGoesBack: Story = {
  args: { initialState: paletteStateAt({ kind: "mission-health" }) },
  play: async ({ canvas }) => {
    await opened(canvas);
    await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent("MissionMission health");

    await userEvent.keyboard("{Backspace}");
    await shows(canvas, "Add sources");
    await expect(canvas.queryByLabelText("Breadcrumb")).toBeNull();
  },
};

export const EscapeClearsBacksAndCloses: Story = {
  args: { initialState: paletteStateAt({ kind: "location-search" }) },
  play: async ({ args, canvas, step }) => {
    await opened(canvas);

    await step("the first Escape clears the search", async () => {
      const search = canvas.getByRole("textbox", { name: "Search" });

      await userEvent.type(search, "Ber");
      await userEvent.keyboard("{Escape}");
      await expect(search).toHaveValue("");
    });

    await step("the next Escape goes back without closing", async () => {
      await userEvent.keyboard("{Escape}");
      await expect(canvas.getByRole("tab", { name: "Commands" })).toBeVisible();
      await expect(args.onClose).not.toHaveBeenCalled();
    });

    await step("Escape at the top closes the palette", async () => {
      await userEvent.keyboard("{Escape}");
      await expect(args.onClose).toHaveBeenCalledOnce();
    });
  },
};

export const TabCyclesCategory: Story = {
  play: async ({ canvas, step }) => {
    await shows(canvas, "Add sources");

    await step("Tab moves to the next category", async () => {
      await userEvent.keyboard("{Tab}");
      await shows(canvas, "Load mission pack");
      await expectSelectedTab(canvas, "Commands");
    });

    await step("Tab after the last category returns to Mission", async () => {
      await userEvent.keyboard("{Tab}{Tab}{Tab}{Tab}");
      await shows(canvas, "Add sources");
      await expectSelectedTab(canvas, "Mission");
    });
  },
};

export const SwitchesPreset: Story = {
  play: async ({ args, canvas }) => {
    await run(canvas, "Switch to Watch");
    await expect(args.layoutActions.presetSelect).toHaveBeenCalledOnce();
    await expect(args.layoutActions.presetSelect).toHaveBeenCalledWith("watch");
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const CustomizesLayout: Story = {
  play: async ({ args, canvas }) => {
    await run(canvas, "Customize layout");
    await expect(args.layoutActions.customize).toHaveBeenCalledOnce();
    await expect(args.layoutActions.resetLayout).not.toHaveBeenCalled();
  },
};

export const ResetsLayout: Story = {
  play: async ({ args, canvas }) => {
    await run(canvas, "Reset layout to preset");
    await expect(args.layoutActions.resetLayout).toHaveBeenCalledOnce();
    await expect(args.layoutActions.customize).not.toHaveBeenCalled();
  },
};

export const CopiesShareLink: Story = {
  play: async ({ args, canvas }) => {
    await run(canvas, "Copy share link");
    await expect(args.layoutActions.shareView).toHaveBeenCalledOnce();
  },
};

export const LocksScreen: Story = {
  play: async ({ args, canvas }) => {
    await run(canvas, "Toggle screen lock");
    await expect(args.layoutActions.toggleScreenLock).toHaveBeenCalledOnce();
    await expect(await screen.findByText("Screen locked")).toBeInTheDocument();
  },
};

export const UnlocksScreen: Story = {
  play: async ({ args, canvas }) => {
    mocked(args.layoutActions.toggleScreenLock).mockReturnValueOnce(false);
    await run(canvas, "Toggle screen lock");
    await expect(args.layoutActions.toggleScreenLock).toHaveBeenCalledOnce();
    await expect(await screen.findByText("Screen unlocked")).toBeInTheDocument();
  },
};

export const ResetWorldFails: Story = {
  play: async ({ canvas, step }) => {
    const user = userEvent.setup();

    await openCommands(canvas);

    await step("holding Enter on Reset world counts down", async () => {
      const row = canvas.getByRole("button", { name: /Reset world/ });

      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter>}");
      await expect(await within(row).findByText(/^1\.\ds$/)).toBeVisible();
    });

    await step("a failed reset shows the error and no success", async () => {
      await expect(
        await screen.findByText(
          "worldClient.hardReset called from a story",
          {},
          { timeout: 4_000 },
        ),
      ).toBeInTheDocument();
      await user.keyboard("{/Enter}");

      await expect(worldClient.hardReset).toHaveBeenCalledOnce();
      await expect(screen.queryByText("All world data cleared")).toBeNull();
    });
  },
};

const sharedTree: LayoutNode = {
  type: "pane",
  id: "pane-1",
  content: { type: "component", componentId: "chatPane" },
};

function seedPendingLayout(presetId: string, presetName: string) {
  seed(useMissionKitStore, {
    nodeId: "node-1",
    pendingLayout: { presetId, presetName, tree: sharedTree },
  });
}

function sharedLayoutFrom(presetId: string, presetName: string) {
  return () => {
    seedPendingLayout(presetId, presetName);
    acceptPushes();
  };
}

function saveSharedView(presetId: string): PaletteState {
  return paletteStateAt({
    kind: "command-group",
    groupId: "save-shared-view",
    groupLabel: "Save shared view",
    initialCommandId: `save-shared-view-${presetId}`,
  });
}

export const SavesSharedLayoutToOtherPreset: Story = {
  args: { initialState: saveSharedView("inspect") },
  beforeEach: sharedLayoutFrom("inspect", "Inspect"),
  play: async ({ args, canvas }) => {
    await shows(canvas, "Save to Overview");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await expect(await screen.findByText("Layout saved to Overview")).toBeInTheDocument();
    await expect(args.layoutActions.saveCustomTree).toHaveBeenCalledOnce();
    await expect(args.layoutActions.saveCustomTree).toHaveBeenCalledWith("overview", sharedTree);
    await expect(args.layoutActions.presetSelect).toHaveBeenCalledOnce();
    await expect(args.layoutActions.presetSelect).toHaveBeenCalledWith("overview");
    await expect(args.layoutActions.clearCustomTree).toHaveBeenCalledOnce();
    await expect(args.layoutActions.clearCustomTree).toHaveBeenCalledWith("inspect");
  },
};

export const SavesSharedLayoutToSamePreset: Story = {
  args: { initialState: saveSharedView("overview") },
  beforeEach: sharedLayoutFrom("overview", "Overview"),
  play: async ({ args, canvas }) => {
    await shows(canvas, "Save to Overview");
    await userEvent.keyboard("{Enter}");
    await expect(await screen.findByText("Layout saved to Overview")).toBeInTheDocument();
    await expect(args.layoutActions.saveCustomTree).toHaveBeenCalledWith("overview", sharedTree);
    await expect(args.layoutActions.presetSelect).toHaveBeenCalledWith("overview");
    await expect(args.layoutActions.clearCustomTree).not.toHaveBeenCalled();
  },
};

export const SaveSharedLayoutFails: Story = {
  args: { initialState: saveSharedView("overview") },
  beforeEach: () => seedPendingLayout("overview", "Overview"),
  play: async ({ args, canvas }) => {
    await shows(canvas, "Save to Overview");
    await userEvent.keyboard("{Enter}");
    await expect(
      await screen.findByText("worldClient.push called from a story"),
    ).toBeInTheDocument();
    await expect(screen.queryByText("Layout saved to Overview")).toBeNull();
    await expect(args.layoutActions.saveCustomTree).not.toHaveBeenCalled();
    await expect(args.layoutActions.presetSelect).not.toHaveBeenCalled();
  },
};

async function pushedId(count: number) {
  await waitFor(() => expect(worldClient.push).toHaveBeenCalledTimes(count));

  return mocked(worldClient.push).mock.lastCall?.[0].changes?.[0]?.id ?? "";
}

function addedCamera(id: string, init?: EntityInit) {
  return entity(id, {
    device: { parent: "axis.service", class: "camera" },
    configurable: { label: "Camera", schema: CAMERA_SCHEMA },
    ...init,
  });
}

async function addCamera(canvas: Canvas) {
  acceptPushes();
  await openService(canvas, "AXIS Cameras");
  await userEvent.click(canvas.getAllByRole("button", { name: "Add Camera" })[0]!);

  const id = await pushedId(1);

  seedEntities([...axisCameraNeedingSetup, addedCamera(id)]);
  await shows(canvas, "Step 1 of 1");

  return id;
}

export const AddedCameraLeftUnsavedIsDeleted: Story = {
  beforeEach: () => seedEntities(axisCameraNeedingSetup),
  play: async ({ canvas }) => {
    const id = await addCamera(canvas);

    mocked(worldClient.expireEntity).mockResolvedValueOnce(create(ExpireEntityResponseSchema));
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(worldClient.expireEntity).toHaveBeenCalledWith({ id }));
    await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(AXIS_PAGE);
  },
};

export const AddedCameraSavedIsKept: Story = {
  beforeEach: () => seedEntities(axisCameraNeedingSetup),
  play: async ({ canvas, step }) => {
    const id = await addCamera(canvas);

    await step("Finish saves the camera and the setup closes once it applies", async () => {
      await userEvent.type(canvas.getByLabelText("Host"), "10.0.4.30");
      await userEvent.click(canvas.getByRole("button", { name: "Finish" }));
      await pushedId(2);
      seedEntities([
        ...axisCameraNeedingSetup,
        addedCamera(id, {
          configurable: {
            label: "Camera",
            schema: CAMERA_SCHEMA,
            state: ConfigurableState.ConfigurableStateActive,
            appliedVersion: 1n,
          },
          config: { value: { host: "10.0.4.30" }, version: 1n },
        }),
      ]);
      await waitFor(() => expect(canvas.queryByRole("button", { name: "Finish" })).toBeNull());
    });

    await step("leaving the service page keeps the saved camera", async () => {
      await userEvent.keyboard("{Escape}");
      await expect(canvas.getByLabelText("Breadcrumb")).toHaveTextContent(
        /^MissionSourcesElectro Optical$/,
      );
      await expect(worldClient.expireEntity).not.toHaveBeenCalled();
    });
  },
};

const radarHub = entity("hub-1", {
  label: "Radar hub",
  device: { state: DeviceState.DeviceStateActive, category: "Sensors" },
  configurable: {
    label: "Radar hub",
    supportedDeviceClasses: [
      { class: "radar.generic", label: "Generic radar" },
      { class: "radar.long-range", label: "Long-range radar" },
    ],
  },
  config: {},
});

const radarHubs = [radarHub, configDevice("radar-2", ConfigurableState.ConfigurableStateActive)];

const mastRadar = configDevice("radar-3", ConfigurableState.ConfigurableStateActive, {
  label: "Mast radar",
  device: { state: DeviceState.DeviceStateActive, category: "Sensors", parent: "hub-1" },
});

export const DeviceClassChipKeepsItsKeys: Story = {
  args: { initialState: paletteStateAt({ kind: "config", entityId: "hub-1", adding: true }) },
  beforeEach: () => seedEntities([...radarHubs, mastRadar]),
  play: async ({ canvas, step }) => {
    await shows(canvas, "Add device to Radar hub");

    const generic = canvas.getByRole("radio", { name: "Generic radar" });
    const longRange = canvas.getByRole("radio", { name: "Long-range radar" });

    await step("Tab reaches the checked chip", async () => {
      for (let press = 0; press < 40 && document.activeElement !== generic; press++) {
        await userEvent.tab();
      }

      await expect(generic).toHaveFocus();
    });

    await step("ArrowRight selects the next chip and leaves the tree collapsed", async () => {
      await userEvent.keyboard("{ArrowRight}");
      await expect(longRange).toHaveFocus();
      await expect(canvas.getByLabelText("Create Long-range radar")).toBeVisible();
      await expect(canvas.queryByText("Mast radar")).toBeNull();
    });

    await step("Enter stays on the chip and leaves the tree collapsed", async () => {
      await userEvent.keyboard("{Enter}");
      await expect(longRange).toHaveFocus();
      await expect(canvas.getByLabelText("Create Long-range radar")).toBeVisible();
      await expect(canvas.queryByText("Mast radar")).toBeNull();
    });
  },
};

export const CreatedDeviceLeftUnsavedIsDeleted: Story = {
  args: { initialState: paletteStateAt({ kind: "config", entityId: "hub-1", adding: true }) },
  beforeEach: () => seedEntities(radarHubs),
  play: async ({ canvas }) => {
    acceptPushes();
    await userEvent.click(await canvas.findByLabelText("Create Generic radar"));

    const id = await pushedId(1);

    seedEntities([
      ...radarHubs,
      entity(id, {
        device: { parent: "hub-1", class: "radar.generic" },
        configurable: { label: "Generic radar", schema: CAMERA_SCHEMA },
      }),
    ]);
    await shows(canvas, id);
    mocked(worldClient.expireEntity).mockResolvedValueOnce(create(ExpireEntityResponseSchema));
    await userEvent.click(canvas.getByText("radar-2"));
    await waitFor(() => expect(worldClient.expireEntity).toHaveBeenCalledWith({ id }));
  },
};
