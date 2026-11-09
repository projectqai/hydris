import { KeyboardProvider } from "@hydris/ui/keyboard";
import type { Canvas } from "@hydris/ui/storybook/queries";
import { shownAlertDialog, toasts, wholeText } from "@hydris/ui/storybook/queries";
import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { ConfigurableState, DeviceState, LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { worldClient } from "../../../../lib/api/world-client";
import { elapseHeldTimeouts, holdTimeouts, STORY_NOW } from "../../../../storybook/clock";
import { answeredWith, streamSchema, WAITING } from "../../../../storybook/config";
import {
  CONFIG_SCHEMA,
  CONFIG_VALUE,
  configDevice,
  entity,
  metric,
  taskable,
} from "../../../../storybook/entities";
import { placementFrom } from "../../../../storybook/providers";
import { acceptPushes } from "../../../../storybook/requests";
import { seedEntities } from "../../../../storybook/seed";
import { HANDSHAKE_TIMEOUT_MS } from "../../hooks/use-config-handshake";
import type { PlacementContextValue } from "../../placement-context";
import { ConfigPanel } from "./config-panel";

type Args = ComponentProps<typeof ConfigPanel> & {
  enterPlacement: PlacementContextValue["enterPlacement"];
};

const sensors = { state: DeviceState.DeviceStateActive, category: "Sensors" };

const radar1 = configDevice("radar-1", ConfigurableState.ConfigurableStateActive, {
  label: "Radar 1",
  link: { status: LinkStatus.LinkStatusConnected, rssiDbm: -61 },
  metric: {
    metrics: [metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 38.2)],
  },
});

const otherDevices = [
  configDevice("radar-2", ConfigurableState.ConfigurableStateFailed, {
    label: "Radar 2",
    device: { ...sensors, state: DeviceState.DeviceStateFailed, error: "Connection refused" },
  }),
  configDevice("radar-3", ConfigurableState.ConfigurableStateActive, {
    label: "Radar 3",
    device: { ...sensors, parent: "hub-1" },
    configurable: {
      label: "Mast radar",
      state: ConfigurableState.ConfigurableStateActive,
      schema: CONFIG_SCHEMA,
      value: CONFIG_VALUE,
    },
  }),
  configDevice("hub-1", ConfigurableState.ConfigurableStateActive, {
    label: "Radar hub",
    configurable: {
      label: "Radar hub",
      state: ConfigurableState.ConfigurableStateActive,
      schema: CONFIG_SCHEMA,
      value: CONFIG_VALUE,
      supportedDeviceClasses: [
        {
          class: "radar.long-range",
          label: "Long-range radar",
          description: "Long range, wide field",
        },
        { class: "radar.generic", label: "Generic radar" },
      ],
    },
  }),
  configDevice("relay-2", ConfigurableState.ConfigurableStateActive, {
    label: "Radio relay",
    configurable: {
      label: "Radio relay",
      state: ConfigurableState.ConfigurableStateActive,
      schema: CONFIG_SCHEMA,
      value: { ...CONFIG_VALUE, cooldown: true, cooldownUntil: STORY_NOW + 240_000 },
    },
  }),
  configDevice("cam-1", ConfigurableState.ConfigurableStateActive, {
    label: "Camera 1",
    symbol: { milStd2525C: "SFGPUCR---*****" },
  }),
  configDevice("cam-2", ConfigurableState.ConfigurableStateActive, {
    label: "Mast camera",
    configurable: {
      label: "Mast camera",
      state: ConfigurableState.ConfigurableStateActive,
      schema: streamSchema(),
      value: {},
      appliedVersion: 3n,
    },
    config: { value: {}, version: 3n },
  }),
  entity("mqtt-1", {
    configurable: {
      label: "MQTT bridge",
      state: ConfigurableState.ConfigurableStateActive,
      schema: CONFIG_SCHEMA,
      value: CONFIG_VALUE,
    },
    config: { value: CONFIG_VALUE },
  }),
  entity("gps-1", { label: "GPS receiver", device: { ...sensors, uniqueHardwareId: "GNSS-4471" } }),
  entity("note-1", { label: "Engine note", configurable: { label: "Engine note" } }),
];

const entities = [radar1, ...otherDevices];

function select(entityId: string) {
  return { selection: { type: "device" as const, entityId } };
}

function radar1Answers(state: ConfigurableState, error?: string, appliedVersion = 4n) {
  seedEntities([answeredWith(radar1, state, error, appliedVersion), ...otherDevices]);
}

async function editHostAndSave(canvas: Canvas) {
  const host = canvas.getByLabelText("Host");

  await userEvent.clear(host);
  await userEvent.type(host, "10.0.0.20");
  await userEvent.click(canvas.getByLabelText("Save configuration"));
}

const meta = {
  title: "Core/Aware/Configuration modal/ConfigPanel",
  component: ConfigPanel,
  tags: ["!autodocs"],
  args: { ...select("radar-1"), onCreated: fn(), enterPlacement: fn() },
  beforeEach: () => seedEntities(entities),
  decorators: [
    (Story) => (
      <KeyboardProvider>
        <View className="native:flex-1 bg-card h-[560px] w-[480px]">
          <Story />
        </View>
      </KeyboardProvider>
    ),
    placementFrom(),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("radar-1")).toBeVisible();
    await expect(canvas.getByText("Radar 1")).toBeVisible();
    await expect(canvas.getByText("2 minutes ago")).toBeVisible();
    await expect(canvas.getByLabelText("Host")).toHaveValue("10.0.0.12");
  },
};

export const SwitchesTabs: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Metrics"));
    await expect(canvas.getByLabelText("Temperature: 38.2 °C, 2 minutes ago")).toBeVisible();

    await userEvent.click(canvas.getByText("Status"));
    await expect(canvas.getByText("-61 dBm")).toBeVisible();
    await expect(canvas.queryByLabelText("Host")).toBeNull();
  },
};

export const WithTaskables: Story = {
  beforeEach: () =>
    seedEntities([
      ...entities,
      taskable("radar-1.recalibrate", "Recalibrate", ["radar-1"]),
      taskable("radar-2.recalibrate", "Recalibrate other radar", ["radar-2"]),
      entity("cam-2.lock", {
        taskable: {
          label: "Lock camera",
          assignee: [{ entityId: "cam-2" }],
          target: { entity: { entity: [] } },
        },
      }),
    ]),
  play: async ({ canvas }) => {
    const user = userEvent.setup();
    const run = canvas.getByRole("button", { name: /^Recalibrate/ });
    const host = canvas.getByLabelText("Host");
    await expect(run.compareDocumentPosition(host)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(canvas.queryByText("Recalibrate other radar")).toBeNull();
    await expect(canvas.queryByText("Lock camera")).toBeNull();

    await user.pointer({ keys: "[MouseLeft>]", target: run });
    await waitFor(
      () => expect(worldClient.runTask).toHaveBeenCalledWith({ entityId: "radar-1.recalibrate" }),
      { timeout: 2_000 },
    );
    await user.pointer({ keys: "[/MouseLeft]", target: run });
  },
};

const SCAN_OPTIONS = [
  { id: "wide", label: "Wide" },
  { id: "narrow", label: "Narrow" },
];

export const ModeSwitchesShowAsPickers: Story = {
  beforeEach: () =>
    seedEntities([
      ...entities,
      taskable("radar-1.recalibrate", "Recalibrate", ["radar-1"]),
      entity("radar-1.scan", {
        taskable: {
          label: "Scan mode",
          assignee: [{ entityId: "radar-1" }],
          target: { mode: { active: "wide", options: SCAN_OPTIONS } },
        },
      }),
      entity("radar-1.beam", {
        taskable: {
          label: "Beam",
          context: [{ entityId: "radar-1" }],
          target: { mode: { active: "narrow", options: SCAN_OPTIONS } },
        },
      }),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Recalibrate/ })).toBeVisible();
    await expect(canvas.getByRole("radiogroup", { name: "Scan mode" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /^Scan mode/ })).toBeNull();

    // Beam switches another entity's mode, so this radar shows it neither as a picker nor as a button
    await expect(canvas.queryByRole("radiogroup", { name: "Beam" })).toBeNull();
    await expect(canvas.queryByText("Beam")).toBeNull();
  },
};

export const ManyFields: Story = { args: select("cam-2") };

export const NothingSelected: Story = {
  args: { selection: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Select a source to view its configuration")).toBeVisible();
  },
};

export const EntityGone: Story = {
  args: select("radar-9"),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Entity no longer available")).toBeVisible();
  },
};

export const DeviceError: Story = {
  args: select("radar-2"),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("Connection refused");
  },
};

export const StatusOnly: Story = {
  args: select("gps-1"),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("GNSS-4471")).toBeVisible();
    await expect(canvas.queryByText("Config")).toBeNull();
  },
};

export const NoTabs: Story = {
  args: select("note-1"),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Select a configurable from the sidebar")).toBeVisible();
  },
};

export const OrphanedConfig: Story = {
  args: select("mqtt-1"),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Host")).toHaveAttribute("readonly");
  },
};

export const Cooldown: Story = {
  args: select("relay-2"),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Abort cooldown")).toHaveTextContent(
      /^Abort cooldown \((4:00|3:5\d)\)$/,
    );
  },
};

export const AbortsCooldown: Story = {
  args: select("relay-2"),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Abort cooldown"));
    await expect(
      await screen.findByText("worldClient.push called from a story"),
    ).toBeInTheDocument();
    await expect(worldClient.push).toHaveBeenCalledWith({
      changes: [
        expect.objectContaining({
          id: "relay-2",
          config: expect.objectContaining({
            value: { ...CONFIG_VALUE, cooldown: false },
            version: 4n,
          }),
        }),
      ],
    });
  },
};

export const SaveFails: Story = {
  play: async ({ canvas }) => {
    await editHostAndSave(canvas);
    await expect(
      await screen.findByText("worldClient.push called from a story"),
    ).toBeInTheDocument();
    await expect(worldClient.push).toHaveBeenCalledWith({
      changes: [
        expect.objectContaining({
          id: "radar-1",
          config: expect.objectContaining({
            value: { ...CONFIG_VALUE, host: "10.0.0.20" },
            version: 4n,
          }),
        }),
      ],
    });
  },
};

export const AwaitsDeviceThenApplies: Story = {
  beforeEach: () => {
    acceptPushes();

    return holdTimeouts(HANDSHAKE_TIMEOUT_MS);
  },
  play: async ({ canvas, step }) => {
    await editHostAndSave(canvas);
    await expect(
      await within(canvas.getByLabelText("Save configuration")).findByRole("progressbar"),
    ).toBeVisible();
    await expect(canvas.getByLabelText("Remove configuration")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await step("after 30 s a waiting line shows the device's word", async () => {
      radar1Answers(ConfigurableState.ConfigurableStateStarting, undefined, 3n);
      elapseHeldTimeouts();

      await expect(await canvas.findByText(wholeText(`${WAITING} (Starting)`))).toBeVisible();
      await expect(toasts().queryByText("Starting")).toBeNull();
      await expect(canvas.getByLabelText("Remove configuration")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await step("a failure hides the line and the backend error shows", async () => {
      radar1Answers(ConfigurableState.ConfigurableStateFailed, "Port 8554 already in use", 3n);

      await expect(await canvas.findByRole("alert")).toHaveProperty(
        "textContent",
        "Failed: Port 8554 already in use",
      );
      await expect(canvas.queryByText(new RegExp(`^${WAITING}`))).toBeNull();
    });

    await step("a late apply still reports success", async () => {
      radar1Answers(ConfigurableState.ConfigurableStateActive);
      await expect(await toasts().findByText("Config applied")).toBeInTheDocument();
      await expect(canvas.queryByText(new RegExp(`^${WAITING}`))).toBeNull();
    });
  },
};

export const DeviceRejectsConfig: Story = {
  beforeEach: acceptPushes,
  play: async ({ canvas }) => {
    await editHostAndSave(canvas);
    await within(canvas.getByLabelText("Save configuration")).findByRole("progressbar");

    radar1Answers(ConfigurableState.ConfigurableStateFailed, "Port 8554 already in use");

    await expect(await toasts().findByText("Port 8554 already in use")).toBeInTheDocument();
  },
};

export const RemoveFails: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Remove configuration"));

    const confirm = await shownAlertDialog("Remove configuration");

    await userEvent.click(confirm.getByText("Remove"));
    await expect(
      await screen.findByText("worldClient.push called from a story"),
    ).toBeInTheDocument();
    await expect(worldClient.push).toHaveBeenCalledWith({
      replacements: [expect.objectContaining({ id: "radar-1", config: undefined })],
    });
    await expect(screen.queryByText("Configuration removed")).toBeNull();
  },
};

export const RemovesConfiguration: Story = {
  beforeEach: acceptPushes,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Remove configuration"));

    const confirm = await shownAlertDialog("Remove configuration");

    await userEvent.click(confirm.getByText("Remove"));
    await expect(await screen.findByText("Configuration removed")).toBeInTheDocument();
    await expect(worldClient.push).toHaveBeenCalledWith({
      replacements: [expect.objectContaining({ id: "radar-1", config: undefined })],
    });
  },
};

export const PlacesOnMap: Story = {
  args: select("cam-1"),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Set position on map"));
    await expect(args.enterPlacement).toHaveBeenCalledOnce();
    await expect(args.enterPlacement).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cam-1" }),
    );
  },
};

export const AddsChildDevice: Story = {
  args: select("hub-1"),
  play: async ({ canvas, step }) => {
    await step("Add lists the device classes the hub supports", async () => {
      await userEvent.click(canvas.getByLabelText("Add"));
      await expect(canvas.getByText("Add device to Radar hub")).toBeVisible();
      await expect(canvas.getByText("Long range, wide field")).toBeVisible();
    });

    await step("choosing a class offers to create it", async () => {
      await userEvent.click(canvas.getByRole("radio", { name: "Generic radar" }));
      await expect(canvas.getByLabelText("Create Generic radar")).toBeVisible();
    });

    await step("Cancel returns to the hub's settings", async () => {
      await userEvent.click(canvas.getByLabelText("Cancel"));
      await expect(canvas.getByLabelText("Host")).toBeVisible();
    });
  },
};

export const OpensInAddMode: Story = {
  args: { ...select("hub-1"), defaultAddMode: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Add device to Radar hub")).toBeVisible();
    await expect(canvas.getByLabelText("Cancel")).toBeVisible();
  },
};

export const CreatesChildDevice: Story = {
  args: select("hub-1"),
  beforeEach: acceptPushes,
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Add"));
    await userEvent.click(canvas.getByRole("radio", { name: "Generic radar" }));
    await userEvent.click(canvas.getByLabelText("Create Generic radar"));
    await waitFor(() => expect(args.onCreated).toHaveBeenCalledOnce());
    await expect(args.onCreated).toHaveBeenCalledWith(
      expect.stringMatching(/^hub-1\.radar\.generic\.[0-9a-f]{8}$/),
    );
    await expect(await screen.findByText("Created Generic radar")).toBeInTheDocument();
  },
};

export const CreateDeviceFails: Story = {
  args: select("hub-1"),
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas, step }) => {
    await step("creating the device sends it under the hub and shows the error", async () => {
      await userEvent.click(canvas.getByLabelText("Add"));
      await userEvent.click(canvas.getByRole("radio", { name: "Generic radar" }));
      await userEvent.click(canvas.getByLabelText("Create Generic radar"));
      await expect(
        await screen.findByText("worldClient.push called from a story"),
      ).toBeInTheDocument();
      await expect(worldClient.push).toHaveBeenCalledWith({
        changes: [
          expect.objectContaining({
            device: expect.objectContaining({ parent: "hub-1", class: "radar.generic" }),
          }),
        ],
      });
    });

    await step("the form stays open and claims no success", async () => {
      await expect(canvas.getByLabelText("Create Generic radar")).toBeVisible();
      await expect(screen.queryByText("Created Generic radar")).toBeNull();
    });
  },
};

export const DeletesChildDevice: Story = {
  args: select("radar-3"),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Delete"));

    const dialog = await shownAlertDialog("Delete device");

    await expect(dialog.getByText('Delete "Radar 3"? This cannot be undone.')).toBeVisible();

    await userEvent.click(dialog.getByLabelText("Delete"));
    await expect(
      await screen.findByText("worldClient.expireEntity called from a story"),
    ).toBeInTheDocument();
    await expect(worldClient.expireEntity).toHaveBeenCalledWith({ id: "radar-3" });
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Delete device" })).toBeNull());
  },
};
