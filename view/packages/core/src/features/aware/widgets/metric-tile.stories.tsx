import { TileFrame } from "@hydris/ui/tile-frame";
import type { Metric } from "@projectqai/proto/metrics";
import { AlertLevel, MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { entity, metric } from "../../../storybook/entities";
import { paneEntity } from "../../../storybook/providers";
import { seedEntities } from "../../../storybook/seed";
import { ENVIRONMENT_CONFIG } from "./environment-widget";
import { MetricTile } from "./metric-tile";
import { VITAL_CONFIG } from "./vital-widget";

type Args = ComponentProps<typeof MetricTile> & { onPin: () => void };

const co2 = metric(MetricKind.MetricKindCo2, MetricUnit.MetricUnitPartsPerMillion, 812);

const temperature = metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 21.4, {
  label: "Air temperature",
});

const humidity = metric(MetricKind.MetricKindHumidity, MetricUnit.MetricUnitPercent, 38);

const ALERT_TEXT = /^(Normal|Warning|Alarm)$/;

function weatherMast(metrics: Metric[]) {
  return entity("env-1", { label: "Weather mast", metric: { metrics } });
}

const pagedMast = weatherMast([
  co2,
  temperature,
  humidity,
  metric(MetricKind.MetricKindPressure, MetricUnit.MetricUnitHectopascal, 1013),
  metric(MetricKind.MetricKindPm25, MetricUnit.MetricUnitMicrogramPerCubicMeter, 9),
  metric(MetricKind.MetricKindPm10, MetricUnit.MetricUnitMicrogramPerCubicMeter, 18),
]);

const medic = entity("vit-1", {
  label: "Medic 2",
  metric: {
    metrics: [
      metric(MetricKind.MetricKindBodyTemperature, MetricUnit.MetricUnitCelsius, 37.1),
      metric(MetricKind.MetricKindOxygenSaturation, MetricUnit.MetricUnitPercent, 97),
      metric(MetricKind.MetricKindHeartRate, MetricUnit.MetricUnitBeatsPerMinute, 72),
    ],
  },
});

const meta = {
  title: "Core/Aware/Widgets/MetricTile",
  component: MetricTile,
  tags: ["!autodocs"],
  argTypes: {
    config: {
      control: "radio",
      options: ["Environment", "Vital"],
      mapping: { Environment: ENVIRONMENT_CONFIG, Vital: VITAL_CONFIG },
    },
  },
  args: { config: ENVIRONMENT_CONFIG, entityId: "env-1", onPin: fn() },
  parameters: { tileSize: "h-72 w-72 native:flex-1" },
  beforeEach: () => seedEntities([weatherMast([co2, temperature, humidity])]),
  decorators: [
    (Story, { parameters }) => (
      <View className={parameters.tileSize}>
        <TileFrame>
          <Story />
        </TileFrame>
      </View>
    ),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Air temperature")).toBeVisible();
    await expect(canvas.getByText("Weather mast")).toBeVisible();
    await expect(canvas.getByText("2m ago")).toBeVisible();
    await expect(canvas.getByText("812")).toHaveTextContent("812 ppm");
    await expect(canvas.getByText("Humidity")).toBeVisible();
    await expect(canvas.queryByLabelText("Next page")).toBeNull();
  },
};

export const Paged: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([pagedMast]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("1/3")).toBeVisible();
    await expect(canvas.getByText("Air temperature")).toBeVisible();
    await expect(canvas.getByText("Humidity")).toBeVisible();
  },
};

export const NextPage: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([pagedMast]),
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByLabelText("Next page"));
    await expect(canvas.getByText("2/3")).toBeVisible();
    await expect(canvas.getByText("Pressure")).toBeVisible();
    await expect(canvas.queryByText("Air temperature")).toBeNull();
  },
};

export const PreviousPageWraps: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([pagedMast]),
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByLabelText("Previous page"));
    await expect(canvas.getByText("3/3")).toBeVisible();
    await expect(canvas.getByText("PM10")).toBeVisible();
  },
};

export const HeroOnly: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([weatherMast([co2])]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("progressbar", { name: "CO₂" })).toHaveAttribute(
      "aria-valuenow",
      "32",
    );
  },
};

export const HeroPriority: Story = {
  args: { config: VITAL_CONFIG, entityId: "vit-1" },
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([medic]),
  play: async ({ canvas }) => {
    const label = await canvas.findByText("Heart Rate");

    await expect(label.previousElementSibling).toHaveTextContent("72 bpm");
  },
};

export const Alerting: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () =>
    seedEntities([
      weatherMast([
        metric(MetricKind.MetricKindCo2, MetricUnit.MetricUnitPartsPerMillion, 2140, {
          alerting: AlertLevel.AlertLevelAlarm,
        }),
        metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 31.5, {
          alerting: AlertLevel.AlertLevelWarning,
        }),
        humidity,
      ]),
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(ALERT_TEXT)).toHaveTextContent("Alarm");
  },
};

export const RowWarning: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () =>
    seedEntities([
      weatherMast([
        co2,
        metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 31.5, {
          label: "Air temperature",
          alerting: AlertLevel.AlertLevelWarning,
        }),
        humidity,
      ]),
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Air temperature")).toBeVisible();
    await expect(canvas.getByText(ALERT_TEXT)).toHaveTextContent("Warning");
  },
};

export const NoMetrics: Story = {
  beforeEach: () => seedEntities([entity("env-1", { label: "Weather mast" })]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No metrics available")).toBeVisible();
  },
};

export const NothingSelected: Story = {
  args: { entityId: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Select an entity or pin one")).toBeVisible();
  },
};

export const PinnedPane: Story = {
  args: { entityId: undefined },
  parameters: { a11y: { test: "todo" } },
  decorators: [paneEntity("env-1")],
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Weather mast")).toBeVisible();

    await userEvent.click(canvas.getByLabelText("Change pinned entity"));
    await expect(args.onPin).toHaveBeenCalledOnce();
  },
};

export const PinnableEmpty: Story = {
  args: { entityId: undefined },
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([]),
  decorators: [paneEntity()],
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Pin an entity"));
    await expect(args.onPin).toHaveBeenCalledOnce();
  },
};

export const CustomHeader: Story = {
  args: { header: { name: "Radiation sensor", timestamp: "--:--" } },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Radiation sensor")).toBeVisible();
    await expect(canvas.getByText("--:--")).toBeVisible();
    await expect(canvas.queryByText("Weather mast")).toBeNull();
  },
};

export const Compact: Story = {
  parameters: { tileSize: "h-40 w-56", a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Air")).toBeVisible();
  },
};

export const Wide: Story = {
  parameters: { tileSize: "h-48 w-[560px]", a11y: { test: "todo" } },
  beforeEach: () => seedEntities([pagedMast]),
};
