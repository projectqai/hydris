import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { DeviceState, LinkStatus, TaskExecutionState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { expect, fn, screen, userEvent } from "storybook/test";

import { worldClient } from "../../../../../lib/api/world-client";
import { ago, nextFresh } from "../../../../../storybook/clock";
import { asset, entity, metric } from "../../../../../storybook/entities";
import { placementFrom } from "../../../../../storybook/providers";
import { acceptRuns } from "../../../../../storybook/requests";
import { seedEntities } from "../../../../../storybook/seed";
import { exactToasts } from "../../../../../storybook/toasts";
import type { PlacementContextValue } from "../../../placement-context";
import { AssetView } from "./asset-view";

type Args = ComponentProps<typeof AssetView> & {
  enterPlacement: PlacementContextValue["enterPlacement"];
};

const connected = LinkStatus.LinkStatusConnected;

const harbourRadar = asset("radar-1", DeviceState.DeviceStateActive, connected, {
  label: "Harbour radar",
  metric: { metrics: [metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 31)] },
});

const mastCamera = asset("cam-2", DeviceState.DeviceStateActive, connected, {
  label: "Mast camera",
  geo: undefined,
});

const relay = asset("relay-1", DeviceState.DeviceStateFailed, undefined, { label: "Relay" });

function autoPosition(state?: TaskExecutionState, reason?: string, fresh = ago(60)) {
  return entity("task-locate", {
    lifetime: { fresh },
    taskable: {
      label: "Locate with GNSS",
      context: [{ entityId: "cam-2" }],
      taxonomy: { kind: { case: "commission", value: { kind: { case: "position", value: {} } } } },
    },
    taskExecution: state === undefined ? undefined : { state, reason },
  });
}

function seedLocateTask(state: TaskExecutionState, reason?: string) {
  seedEntities([mastCamera, autoPosition(state, reason)]);
}

function report(state: TaskExecutionState, reason?: string) {
  seedEntities([mastCamera, autoPosition(state, reason, nextFresh())]);
}

function Closable({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <View className="flex-1">
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
        <Text className="text-foreground">Close asset view</Text>
      </Pressable>
      {open && children}
    </View>
  );
}

const meta = {
  title: "Core/Aware/Command palette/Views/AssetView",
  component: AssetView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { entityId: "cam-2", dispatch: fn(), enterPlacement: fn() },
  beforeEach: () => seedEntities([harbourRadar, mastCamera, relay, autoPosition()]),
  decorators: [
    (Story) => (
      <View className="native:flex-1 native:w-full h-[440px] w-[560px]">
        <Story />
      </View>
    ),
    placementFrom(),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Mast camera")).toBeVisible();
    await expect(canvas.getByText("Not ready")).toBeVisible();
    await expect(canvas.getByText("Locate with GNSS")).toBeVisible();
  },
};

export const FailedAsset: Story = {
  args: { entityId: "relay-1" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Relay")).toBeVisible();
    await expect(canvas.getByText("Not ready")).toBeVisible();
    await expect(canvas.queryByText("Place on map")).toBeNull();
    await expect(canvas.getByText("Open Configuration")).toBeVisible();
  },
};

export const ReadyAsset: Story = {
  args: { entityId: "radar-1" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Harbour radar")).toBeVisible();
    await expect(canvas.getByText("2 minutes ago")).toBeVisible();
    await expect(canvas.getByText("Ready")).toBeVisible();
  },
};

export const AssetGone: Story = {
  args: { entityId: "gone-1" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Asset no longer exists")).toBeVisible();
  },
};

export const LocatesWithGnss: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    await expect(
      await screen.findByText("worldClient.runTask called from a story"),
    ).toBeInTheDocument();
    await expect(worldClient.runTask).toHaveBeenCalledOnce();
    await expect(worldClient.runTask).toHaveBeenCalledWith({ entityId: "task-locate" });
  },
};

export const PositioningSucceeds: Story = {
  beforeEach: acceptRuns,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    report(TaskExecutionState.TaskExecutionStatePending);
    await expect(await canvas.findByText("Positioning…")).toBeVisible();
    report(TaskExecutionState.TaskExecutionStateRunning);
    report(TaskExecutionState.TaskExecutionStateCompleted);

    await expect(await exactToasts(1)).toEqual([expect.stringContaining("Positioned")]);
  },
};

export const PositioningFails: Story = {
  beforeEach: acceptRuns,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    report(TaskExecutionState.TaskExecutionStatePending);
    report(TaskExecutionState.TaskExecutionStateFailed, "No GNSS fix");

    const [toast] = await exactToasts(1);
    await expect(toast).toContain("Locate with GNSS");
    await expect(toast).toContain("No GNSS fix");
  },
};

export const RetryFailsInOneBatch: Story = {
  beforeEach: acceptRuns,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    report(TaskExecutionState.TaskExecutionStateFailed, "No GNSS fix");
    await exactToasts(1);

    await userEvent.click(canvas.getByRole("button", { name: "Locate with GNSS" }));
    report(TaskExecutionState.TaskExecutionStateFailed, "Antenna disconnected");

    await expect(await exactToasts(1)).toEqual([expect.stringContaining("Antenna disconnected")]);
  },
};

export const IgnoresEarlierResult: Story = {
  beforeEach: [
    () => seedLocateTask(TaskExecutionState.TaskExecutionStateFailed, "Old fault"),
    acceptRuns,
  ],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    report(TaskExecutionState.TaskExecutionStateCompleted);

    await expect(await exactToasts(1)).toEqual([expect.stringContaining("Positioned")]);
  },
};

export const SucceedsAfterEarlierSuccess: Story = {
  beforeEach: [() => seedLocateTask(TaskExecutionState.TaskExecutionStateCompleted), acceptRuns],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    report(TaskExecutionState.TaskExecutionStateCompleted);

    await expect(await exactToasts(1)).toEqual([expect.stringContaining("Positioned")]);
  },
};

export const IgnoresOtherClientsRun: Story = {
  beforeEach: acceptRuns,
  play: async ({ canvas }) => {
    report(TaskExecutionState.TaskExecutionStatePending);
    report(TaskExecutionState.TaskExecutionStateCompleted);
    report(TaskExecutionState.TaskExecutionStatePending);
    report(TaskExecutionState.TaskExecutionStateFailed, "No GNSS fix");

    await userEvent.click(canvas.getByText("Locate with GNSS"));
    report(TaskExecutionState.TaskExecutionStateCompleted);

    await expect(await exactToasts(1)).toEqual([expect.stringContaining("Positioned")]);
  },
};

export const SucceedsAfterViewCloses: Story = {
  beforeEach: acceptRuns,
  render: (args) => (
    <Closable>
      <AssetView {...args} />
    </Closable>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Locate with GNSS"));
    await userEvent.click(canvas.getByText("Close asset view"));
    await expect(canvas.queryByText("Locate with GNSS")).toBeNull();
    report(TaskExecutionState.TaskExecutionStateCompleted);

    await expect(await exactToasts(1)).toEqual([expect.stringContaining("Positioned")]);
  },
};

export const PlacesOnMap: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Place on map"));
    await expect(args.enterPlacement).toHaveBeenCalledOnce();
    await expect(args.enterPlacement).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cam-2" }),
    );
  },
};

export const OpensConfiguration: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Open Configuration"));
    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "config", entityId: "cam-2" },
    });
  },
};
