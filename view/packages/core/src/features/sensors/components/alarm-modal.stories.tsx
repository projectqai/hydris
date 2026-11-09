import { ControlButton } from "@hydris/ui/controls";
import { shownDialog } from "@hydris/ui/storybook/queries";
import { MetricUnit } from "@projectqai/proto/metrics";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import { alarm, DOSE_RATE } from "../../../storybook/alarms";
import { coreProviders } from "../../../storybook/providers";
import type { SensorReading } from "../types";
import { AlarmModal } from "./alarm-modal";

const chemical: SensorReading = {
  shape: "levels",
  unit: "bars",
  levels: [
    { code: "CH2", value: 4 },
    { code: "CH1", value: 7 },
    { code: "CH3", value: 1 },
  ],
};

type AlarmModalPropsAndCustomArgs = ComponentProps<typeof AlarmModal> & { open: boolean };

const meta = {
  title: "Core/Sensors/AlarmModal",
  component: AlarmModal,
  tags: ["!autodocs"],
  args: {
    open: true,
    alarm: { ...alarm("rad-north-1", DOSE_RATE), sensorName: "Radiation sensor north" },
    onAcknowledge: fn(),
  },
  decorators: [coreProviders()],
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  play: async () => {
    await shownDialog();
  },
  render: function Render({ open, ...args }) {
    const [, updateArgs] = useArgs<AlarmModalPropsAndCustomArgs>();

    if (!open) {
      return <ControlButton label="Show alarm" onPress={() => updateArgs({ open: true })} />;
    }

    return (
      <AlarmModal
        {...args}
        onAcknowledge={() => {
          args.onAcknowledge();
          updateArgs({ open: false });
        }}
      />
    );
  },
} satisfies Meta<AlarmModalPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async () => {
    const dialog = await shownDialog();

    await expect(dialog.getByText("Radiation")).toBeVisible();
    await expect(dialog.getByText("4.20 µSv/h")).toBeVisible();
  },
};

export const ScaledReading: Story = {
  args: {
    alarm: alarm("rad-north-1", {
      shape: "metric",
      primary: { value: 1520, unit: MetricUnit.MetricUnitMicrosievertPerHour },
    }),
  },
  play: async () => {
    const dialog = await shownDialog();

    await expect(dialog.getByText("1.52 mSv/h")).toBeVisible();
  },
};

export const LevelWithCode: Story = {
  args: { alarm: alarm("chem-1", chemical, "CH3") },
  play: async () => {
    const dialog = await shownDialog();

    await expect(dialog.getByText("Chemical")).toBeVisible();
    await expect(dialog.getByText("CH3: 1 bars")).toBeVisible();
  },
};

export const LevelWithoutCode: Story = {
  args: { alarm: alarm("chem-1", chemical) },
  play: async () => {
    const dialog = await shownDialog();

    await expect(dialog.getByText("CH1: 7 bars")).toBeVisible();
  },
};

export const LongSensorName: Story = {
  args: {
    alarm: {
      ...alarm("rad-north-1", DOSE_RATE),
      sensorName: "Radiation sensor north perimeter fence 04",
    },
  },
};

export const Acknowledges: Story = {
  play: async ({ args }) => {
    const dialog = await shownDialog();

    await userEvent.click(dialog.getByText("ACKNOWLEDGE"));
    await expect(args.onAcknowledge).toHaveBeenCalledOnce();
  },
};

export const EscapeAcknowledges: Story = {
  play: async ({ args }) => {
    await shownDialog();

    await userEvent.keyboard("{Escape}");
    await expect(args.onAcknowledge).toHaveBeenCalledOnce();
  },
};
