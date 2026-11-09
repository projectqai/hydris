import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect } from "storybook/test";

import { ago } from "../../../../storybook/clock";
import { entity, metric } from "../../../../storybook/entities";
import { seedEntities } from "../../../../storybook/seed";
import { MetricsSection } from "./metrics-section";

const temperature = metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 21.4, {
  id: 1,
});
const pressure = metric(MetricKind.MetricKindPressure, MetricUnit.MetricUnitHectopascal, 1013, {
  id: 2,
});

const meta = {
  title: "Core/Aware/Configuration modal/MetricsSection",
  component: MetricsSection,
  argTypes: { entity: { control: false }, sharedTimestamp: { control: false } },
  tags: ["!autodocs"],
  args: {
    entity: entity("env-1", { metric: { metrics: [temperature, pressure] } }),
    sharedTimestamp: null,
  },
  beforeEach: ({ args }) => seedEntities([args.entity]),
} satisfies Meta<typeof MetricsSection>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Temperature: 21.4 °C, 2 minutes ago")).toBeVisible();
    await expect(canvas.getAllByText("2 minutes ago")).toHaveLength(2);
    await expect(canvas.queryByRole("heading")).toBeNull();
  },
};

export const SharedTimestamp: Story = {
  args: { sharedTimestamp: ago(120) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("1,013 hPa")).toBeVisible();
    await expect(canvas.queryByText("2 minutes ago")).toBeNull();
  },
};

export const MultipleGroups: Story = {
  args: {
    entity: entity("ups-1", {
      metric: {
        metrics: [
          temperature,
          pressure,
          metric(MetricKind.MetricKindVoltage, MetricUnit.MetricUnitVolt, 24.1, {
            id: 3,
            measuredAt: ago(3_600),
          }),
          metric(MetricKind.MetricKindCurrent, MetricUnit.MetricUnitAmpere, 1.8, {
            id: 4,
            measuredAt: ago(3_600),
          }),
          metric(MetricKind.MetricKindFuel, MetricUnit.MetricUnitPercent, 64, { id: 5 }),
          metric(MetricKind.MetricKindFuel, MetricUnit.MetricUnitPercent, 58, {
            id: 6,
            label: "Reserve fuel",
            measuredAt: ago(600),
          }),
        ],
      },
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "Environmental, 2 minutes ago" }),
    ).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Electrical, 1 hour ago" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Equipment" })).toBeVisible();
    await expect(canvas.getByText("10 minutes ago")).toBeVisible();
  },
};

export const Gauge: Story = {
  args: {
    entity: entity("gen-1", {
      metric: {
        metrics: [
          metric(MetricKind.MetricKindPercentage, MetricUnit.MetricUnitRatio, 0.35, {
            id: 1,
            label: "Fuel level",
          }),
          metric(MetricKind.MetricKindHumidity, MetricUnit.MetricUnitPercent, 64, { id: 2 }),
        ],
      },
    }),
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("progressbar", { name: "Fuel level: 35%, 2 minutes ago" }),
    ).toHaveAttribute("aria-valuenow", "35");
    await expect(
      canvas.getByRole("progressbar", { name: "Humidity: 64%, 2 minutes ago" }),
    ).toHaveAttribute("aria-valuenow", "64");
  },
};

export const Empty: Story = {
  args: { entity: entity("node-1") },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No metrics available")).toBeVisible();
  },
};
