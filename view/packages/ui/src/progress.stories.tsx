import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { expect } from "storybook/test";

import type { StateSeverity } from "./lib/severity";
import { SEVERITY_DOT } from "./lib/severity";
import { Progress, ProgressIndicator, ProgressTrack } from "./progress";

type ProgressStoryArgs = ComponentProps<typeof Progress> & { severity?: StateSeverity };

function ProgressStory({ severity, children, ...props }: ProgressStoryArgs) {
  return (
    <Progress {...props}>
      {children}
      <ProgressTrack>
        <ProgressIndicator className={severity ? SEVERITY_DOT[severity] : undefined} />
      </ProgressTrack>
    </Progress>
  );
}

const meta = {
  title: "UI/Feedback and status/Progress",
  component: ProgressStory,
  subcomponents: { ProgressTrack, ProgressIndicator },
  args: { value: 35, accessibilityLabel: "Fuel level" },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100, step: 1 } },
    severity: { control: "select", options: Object.keys(SEVERITY_DOT) },
    children: { control: false },
  },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ProgressStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { value: 0 } };

export const Full: Story = { args: { value: 100 } };

export const ClampsAboveFull: Story = {
  args: { value: 140 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("progressbar", { name: "Fuel level" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  },
};

export const ClampsBelowEmpty: Story = {
  args: { value: -20 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("progressbar", { name: "Fuel level" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  },
};

export const WithLabel: Story = {
  args: {
    className: "gap-1.5",
    children: (
      <View className="flex-row items-baseline justify-between">
        <Text className="text-foreground/80 font-sans text-sm">Fuel level</Text>
        <Text className="text-foreground font-mono text-sm">35%</Text>
      </View>
    ),
  },
};

export const SeverityIndicator: Story = {
  args: { value: 92, severity: "alert" },
};
