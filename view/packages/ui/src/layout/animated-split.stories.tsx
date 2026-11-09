import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { expect, fn, waitFor } from "storybook/test";

import { FakeLayoutEditing } from "../storybook/layout-editing";
import { center, drag, tap } from "../storybook/pointer";
import { screenLocked } from "../storybook/screen-lock";
import { AnimatedSplit } from "./animated-split";
import { DIVIDER_SIZE } from "./constants";
import type { LayoutEditingContextValue } from "./types";

function Pane({ label }: { label: string }) {
  return (
    <View className="bg-card flex-1 items-center justify-center">
      <Text className="font-sans-medium text-13 text-foreground">{label}</Text>
    </View>
  );
}

const offset = (ratio: number, stage: number) =>
  (ratio * (stage - DIVIDER_SIZE) + DIVIDER_SIZE) / 2;

type AnimatedSplitPropsAndCustomArgs = ComponentProps<typeof AnimatedSplit> &
  Pick<LayoutEditingContextValue, "onRatioChange">;

const meta = {
  title: "UI/Layout/AnimatedSplit",
  component: AnimatedSplit,
  args: {
    path: [],
    direction: "horizontal",
    targetRatio: 0.4,
    first: "First",
    second: "Second",
    onRatioChange: fn(),
  },
  argTypes: {
    first: { control: false, mapping: { First: <Pane label="First" /> } },
    second: { control: false, mapping: { Second: <Pane label="Second" /> } },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("slider")).toBeVisible();
  },
  decorators: [
    (Story) => (
      <View className="h-56 w-[480px]">
        <Story />
      </View>
    ),
    (Story, { args }) => (
      <FakeLayoutEditing onRatioChange={args.onRatioChange}>
        <Story />
      </FakeLayoutEditing>
    ),
  ],
} satisfies Meta<AnimatedSplitPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Vertical: Story = { args: { direction: "vertical", targetRatio: 0.5 } };

export const WhileCustomizing: Story = {
  args: { targetRatio: 0.5 },
  decorators: [
    (Story) => (
      <FakeLayoutEditing isCustomizing>
        <Story />
      </FakeLayoutEditing>
    ),
  ],
};

export const FirstPaneCollapsed: Story = { args: { targetRatio: 0.05 } };

export const TapRestoresCollapsedPane: Story = {
  play: async ({ args, canvas }) => {
    const divider = await canvas.findByRole("slider", { name: "Resize columns" });
    const first = canvas.getByText("First");

    await waitFor(() =>
      expect(center(divider).clientX - center(first).clientX).toBeCloseTo(offset(0.4, 480), 0),
    );

    const from = center(divider);
    const start = { ...from, clientY: from.clientY + 30 };

    await drag(
      from,
      { ...start, clientX: start.clientX - 300 },
      { moveFrom: start, steps: 48, delay: 20 },
    );
    await waitFor(() =>
      expect(args.onRatioChange).toHaveBeenCalledWith([], expect.closeTo(0.046, 3)),
    );

    await tap(center(divider));
    await waitFor(() => expect(args.onRatioChange).toHaveBeenCalledTimes(2));
    await expect(args.onRatioChange).toHaveBeenLastCalledWith([], 0.4);
  },
};

export const DragsDivider: Story = {
  play: async ({ args, canvas }) => {
    const divider = await canvas.findByRole("slider", { name: "Resize columns" });
    const first = canvas.getByText("First");

    await waitFor(() =>
      expect(center(divider).clientX - center(first).clientX).toBeCloseTo(offset(0.4, 480), 0),
    );

    const from = center(divider);
    const start = { ...from, clientY: from.clientY + 30 };

    await drag(
      from,
      { ...start, clientX: start.clientX + 96 },
      { moveFrom: start, steps: 48, delay: 20 },
    );

    await waitFor(() => expect(args.onRatioChange).toHaveBeenCalledOnce());
    await expect(args.onRatioChange).toHaveBeenCalledWith([], 0.6);
  },
};

export const DragsRowDivider: Story = {
  args: Vertical.args,
  play: async ({ args, canvas }) => {
    const divider = await canvas.findByRole("slider", { name: "Resize rows" });
    const first = canvas.getByText("First");

    await waitFor(() =>
      expect(center(divider).clientY - center(first).clientY).toBeCloseTo(offset(0.5, 224), 0),
    );

    const from = center(divider);
    const start = { ...from, clientX: from.clientX + 30 };

    await drag(
      from,
      { ...start, clientY: start.clientY + 54 },
      { moveFrom: start, steps: 48, delay: 20 },
    );

    await waitFor(() => expect(args.onRatioChange).toHaveBeenCalledOnce());
    await expect(args.onRatioChange).toHaveBeenCalledWith([], 0.75);
  },
};

export const ScreenLocked: Story = {
  args: { targetRatio: 0.05 },
  decorators: [screenLocked],
  play: async ({ args, canvas }) => {
    const divider = await canvas.findByRole("slider", { name: "Resize columns" });
    const first = canvas.getByText("First");

    await waitFor(() =>
      expect(center(divider).clientX - center(first).clientX).toBeCloseTo(offset(0.05, 480), 0),
    );

    const from = center(divider);
    const start = { ...from, clientY: from.clientY + 30 };

    await tap(from);
    await drag(
      from,
      { ...start, clientX: start.clientX + 96 },
      { moveFrom: start, steps: 48, delay: 20 },
    );
    await expect(args.onRatioChange).not.toHaveBeenCalled();
  },
};
