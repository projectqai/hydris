import { create } from "@bufbuild/protobuf";
import { MetricComponentSchema, MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { withSchema } from "../../../../../storybook/config";
import { CONFIG_SCHEMA, metric } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { coreProviders } from "../../../../../storybook/providers";
import { seedEntities } from "../../../../../storybook/seed";
import { riverGauges } from "../../../../../storybook/sensors";
import { DeviceView } from "./device-view";

const nodes = riverGauges({ "gauge-03": { pump: DeviceState.DeviceStateFailed } }).map((e) =>
  e.id === "gauge-03" ? withSchema(e, CONFIG_SCHEMA) : e,
);

const meta = {
  title: "Core/Aware/Command palette/Views/DeviceView",
  component: DeviceView,
  tags: ["!autodocs"],
  argTypes: {
    source: { control: "radio", options: ["electroOptical", "sensor"] },
    tab: { control: "radio", options: ["overview", "metrics", "status"] },
    dispatch: { control: false },
  },
  args: { source: "sensor", entityId: "gauge-03", onTabChange: fn(), dispatch: fn() },
  beforeEach: () => seedEntities(nodes, { isConnected: true }),
  decorators: [paletteView({ keyboard: false }), coreProviders()],
} satisfies Meta<typeof DeviceView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, step }) => {
    await step("the header word sums the node and everything below it", async () => {
      const tiles = canvas.getAllByRole("button");

      const header = canvas
        .getAllByText("Failed")
        .filter((el) => !tiles.some((t) => t.contains(el)));

      await expect(header).toHaveLength(1);
    });

    await step("the node's own tile comes first and opens the node's settings", async () => {
      await expect(canvas.getByText("Battery")).toBeVisible();
      await userEvent.click(canvas.getByText("Battery"));
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "settings", entityId: "gauge-03" },
      });
    });

    await step("each child follows by label, a failing one in its own word", async () => {
      await expect(
        canvas.getAllByRole("button", { name: /^(Rain sensor|gauge-03\.pump)/ }),
      ).toEqual([
        canvas.getByRole("button", { name: /^gauge-03\.pump Failed/ }),
        canvas.getByRole("button", { name: /^Rain sensor Active/ }),
      ]);
    });

    await step("a child waiting for setup opens its setup", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^gauge-03\.pump/ }));
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "setup", entityId: "gauge-03.pump" },
      });
    });

    await step("any other child opens its own device page", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Rain sensor/ }));
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: {
          kind: "device",
          source: "sensor",
          entityId: "gauge-03.rain",
        },
      });
    });

    await step("settings opens the device's settings", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Config" }));
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "settings", entityId: "gauge-03" },
      });
    });
  },
};

export const WithoutSettings: Story = {
  args: { entityId: "gauge-04" },
  play: async ({ canvas }) => {
    const battery = canvas.getByText("Battery");

    await expect(battery).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Config" })).toBeNull();
    await expect(canvas.getAllByRole("button").some((b) => b.contains(battery))).toBe(false);
  },
};

export const MetricsAndStatus: Story = {
  beforeEach: () =>
    seedEntities(
      nodes.map((e) =>
        e.id === "gauge-03"
          ? {
              ...e,
              metric: create(MetricComponentSchema, {
                metrics: [
                  metric(MetricKind.MetricKindCount, MetricUnit.MetricUnitCount, 1, {
                    label: "Readings sent",
                  }),
                ],
              }),
            }
          : e,
      ),
      { isConnected: true },
    ),
  args: { tab: "metrics" },
  play: async ({ args, canvas, step }) => {
    await step("metrics shows the node's metrics", async () => {
      await expect(await canvas.findByText("Readings sent")).toBeVisible();
    });

    await step("status is asked for when pressed", async () => {
      await userEvent.click(canvas.getByTestId("tab-status"));
      await expect(args.onTabChange).toHaveBeenCalledWith("status");
    });
  },
};

export const NoMetrics: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tab-overview")).toBeVisible();
    await expect(canvas.getByTestId("tab-status")).toBeVisible();
    await expect(canvas.queryByTestId("tab-metrics")).toBeNull();
  },
};

export const DeviceDisappearsWhileOpen: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Config" })).toBeVisible();

    seedEntities(
      nodes.filter((e) => e.id !== "gauge-03"),
      { isConnected: true },
    );
    await expect(await canvas.findByText("Device no longer exists")).toBeVisible();
  },
};
