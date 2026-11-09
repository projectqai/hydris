import { MetricKind, MetricUnit } from "@projectqai/proto/metrics";
import { LinkStatus } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Activity, BarChart3 } from "lucide-react-native";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { alarm, DOSE_RATE } from "../../../storybook/alarms";
import { metric, radiationSensor } from "../../../storybook/entities";
import { paletteOpener } from "../../../storybook/providers";
import { seedAlarms, seedEntities } from "../../../storybook/seed";
import type { PaletteContextValue } from "../../aware/palette-context";
import { SensorWidgetShell } from "./sensor-widget-shell";

type Args = ComponentProps<typeof SensorWidgetShell> & {
  onOpenPalette: PaletteContextValue["open"];
};

const accumulatedOnly = {
  metrics: [
    metric(MetricKind.MetricKindRadiationHazard, MetricUnit.MetricUnitMicrosievert, 12.4, {
      id: 2,
    }),
  ],
};

const connected = radiationSensor("rad-1", 0.42, { label: "Radiation sensor" });

const lostWithReading = radiationSensor("rad-1", 0.42, {
  label: "Radiation sensor",
  link: { status: LinkStatus.LinkStatusLost },
});

const lostNoReading = radiationSensor("rad-1", 0.42, {
  label: "Radiation sensor",
  link: { status: LinkStatus.LinkStatusLost },
  metric: accumulatedOnly,
});

const meta = {
  title: "Core/Sensors/SensorWidgetShell",
  component: SensorWidgetShell,
  tags: ["!autodocs"],
  argTypes: {
    icon: { options: ["Activity", "BarChart3"], mapping: { Activity, BarChart3 } },
  },
  args: {
    entityId: "rad-1",
    onOpenPalette: fn(),
    children: () => <Text className="text-foreground font-sans text-sm">Reading body</Text>,
  },
  decorators: [
    (Story) => (
      <View className="h-56 w-72">
        <Story />
      </View>
    ),
    paletteOpener(),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => seedEntities([connected]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Radiation sensor")).toBeVisible();
    await expect(canvas.getByText("2m ago")).toBeVisible();
    await expect(canvas.getByText("MED")).toBeVisible();
    await expect(canvas.getByText("Reading body")).toBeVisible();
  },
};

export const NoData: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No data available")).toBeVisible();
  },
};

export const ConnectionLost: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([lostNoReading]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Connection lost")).toBeVisible();
    await expect(canvas.queryByText("Reading body")).toBeNull();
  },
};

export const DisconnectedWithReading: Story = {
  beforeEach: () => seedEntities([lostWithReading]),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText("Disconnected")).toHaveLength(2);
    await expect(canvas.getByText("Reading body")).toBeVisible();
  },
};

export const WarmingUp: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () =>
    seedEntities([
      radiationSensor("rad-1", 0.42, { label: "Radiation sensor", metric: accumulatedOnly }),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Warming up")).toBeVisible();
    await expect(canvas.queryByText("Reading body")).toBeNull();
  },
};

export const Headerless: Story = {
  args: { headerless: true },
  beforeEach: () => seedEntities([connected]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Reading body")).toBeVisible();
    await expect(canvas.queryByText("Radiation sensor")).toBeNull();
  },
};

export const HeaderlessConnectionLost: Story = {
  args: { headerless: true },
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => seedEntities([lostNoReading]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Radiation sensor")).toBeVisible();
    await expect(canvas.getByText("Connection lost")).toBeVisible();
  },
};

export const Alarm: Story = {
  beforeEach: [() => seedEntities([connected]), () => seedAlarms([alarm("rad-1", DOSE_RATE)])],
};

export const Cooldown: Story = {
  beforeEach: () =>
    seedEntities([
      radiationSensor("rad-1", 0.42, {
        label: "Radiation sensor",
        configurable: { value: { cooldown: true } },
      }),
    ]),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("canvas")).toBeNull();
  },
};

export const OpensConfig: Story = {
  beforeEach: () => seedEntities([connected]),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Reading body"));
    await expect(args.onOpenPalette).toHaveBeenCalledOnce();
    await expect(args.onOpenPalette).toHaveBeenCalledWith({ kind: "config", entityId: "rad-1" });
  },
};
