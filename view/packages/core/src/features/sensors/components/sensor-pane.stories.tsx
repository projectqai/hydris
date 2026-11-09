import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { chemicalSensor, entity, metric, radiationSensor } from "../../../storybook/entities";
import { paneEntity } from "../../../storybook/providers";
import { seedEntities } from "../../../storybook/seed";
import { SensorPane } from "./sensor-pane";

type Args = ComponentProps<typeof SensorPane> & { onPin: () => void };

const meta = {
  title: "Core/Sensors/SensorPane",
  component: SensorPane,
  tags: ["!autodocs"],
  args: { onPin: fn() },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-64 w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pin a sensor to view readings")).toBeVisible();
  },
};

export const PinnedSensorUnavailable: Story = {
  args: { entityId: "rad-9" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pinned sensor unavailable")).toBeVisible();
  },
};

export const NoSensorReadings: Story = {
  args: { entityId: "env-1" },
  beforeEach: () =>
    seedEntities([
      entity("env-1", {
        metric: {
          metrics: [metric(MetricKind.MetricKindTemperature, MetricUnit.MetricUnitCelsius, 21.4)],
        },
      }),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No sensor readings")).toBeVisible();
  },
};

const radiation = MetricKind.MetricKindRadiationHazard;

export const Radiation: Story = {
  args: { entityId: "rad-1" },
  beforeEach: () =>
    seedEntities([
      radiationSensor("rad-1", 0.42, {
        label: "Radiation sensor",
        metric: {
          metrics: [
            metric(radiation, MetricUnit.MetricUnitMicrosievert, 12.4, { id: 2 }),
            metric(radiation, MetricUnit.MetricUnitMicrosievertPerHour, 0.42, { id: 1 }),
          ],
        },
      }),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Radiation sensor")).toBeVisible();
    await expect(canvas.getByText("MED")).toBeVisible();

    const doseRate = await canvas.findByText("0.42");

    await expect(doseRate).toHaveTextContent("0.42 µSv/h");
    await expect(doseRate.nextElementSibling).toHaveTextContent("Radiation");
  },
};

export const Chemical: Story = {
  args: { entityId: "chem-1" },
  beforeEach: () =>
    seedEntities([
      chemicalSensor("chem-1", [
        { code: "CH1", value: 7 },
        { code: "CH2", value: 4 },
      ]),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("7")).toHaveTextContent("7/8");
  },
};

export const Pinnable: Story = {
  parameters: { a11y: { test: "todo" } },
  decorators: [paneEntity()],
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Pin an entity"));
    await expect(args.onPin).toHaveBeenCalledOnce();
  },
};

export const PinnedUnavailableCanRepin: Story = {
  args: { entityId: "rad-9" },
  parameters: { a11y: { test: "todo" } },
  decorators: [paneEntity("rad-9")],
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Change pinned entity"));
    await expect(args.onPin).toHaveBeenCalledOnce();
  },
};
