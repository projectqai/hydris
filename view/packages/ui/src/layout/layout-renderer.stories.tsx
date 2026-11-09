import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { expect, fn, waitFor } from "storybook/test";

import { FakeLayoutEditing } from "../storybook/layout-editing";
import { center, drag } from "../storybook/pointer";
import { DIVIDER_SIZE } from "./constants";
import { LeafRendererContext } from "./contexts";
import { LayoutRenderer } from "./layout-renderer";
import type { LayoutEditingContextValue, LeafRendererProps } from "./types";

function Leaf({ content }: LeafRendererProps) {
  return (
    <View className="bg-card flex-1 items-center justify-center">
      <Text className="font-sans-medium text-13 text-foreground">
        {content.type === "component" ? content.componentId : content.type}
      </Text>
    </View>
  );
}

type LayoutRendererPropsAndCustomArgs = ComponentProps<typeof LayoutRenderer> &
  Pick<LayoutEditingContextValue, "onRatioChange">;

const meta = {
  title: "UI/Layout/LayoutRenderer",
  component: LayoutRenderer,
  args: {
    onRatioChange: fn(),
    node: {
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      first: { type: "pane", id: "map", content: { type: "component", componentId: "map" } },
      second: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "pane", id: "camera", content: { type: "camera" } },
        second: { type: "pane", id: "empty", content: { type: "empty" } },
      },
    },
  },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-72 w-[560px]">
        <Story />
      </View>
    ),
    (Story, { args }) => (
      <FakeLayoutEditing totalPanes={3} onRatioChange={args.onRatioChange}>
        <LeafRendererContext.Provider value={Leaf}>
          <Story />
        </LeafRendererContext.Provider>
      </FakeLayoutEditing>
    ),
  ],
} satisfies Meta<LayoutRendererPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("map")).toBeVisible();
    await expect(await canvas.findByText("camera")).toBeVisible();
    await expect(await canvas.findByText("empty")).toBeVisible();
    await expect(canvas.getByRole("slider", { name: "Resize columns" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
    await expect(canvas.getByRole("slider", { name: "Resize rows" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  },
};

export const DragsNestedDivider: Story = {
  args: {
    node: {
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      first: { type: "pane", id: "map", content: { type: "component", componentId: "map" } },
      second: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "pane", id: "chat", content: { type: "component", componentId: "chat" } },
        second: {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "pane", id: "camera", content: { type: "camera" } },
          second: { type: "pane", id: "empty", content: { type: "empty" } },
        },
      },
    },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    const camera = await canvas.findByText("camera");
    const rows = canvas.getByRole("slider", { name: "Resize rows" });

    await waitFor(() =>
      expect(center(rows).clientY - center(camera).clientY).toBeCloseTo(
        (0.5 * (288 - DIVIDER_SIZE) + DIVIDER_SIZE) / 2,
        0,
      ),
    );

    const from = center(rows);
    const start = { ...from, clientX: from.clientX + 30 };

    await drag(
      from,
      { ...start, clientY: start.clientY + 70 },
      { moveFrom: start, steps: 48, delay: 20 },
    );
    await waitFor(() => expect(args.onRatioChange).toHaveBeenCalledOnce());
    await expect(args.onRatioChange).toHaveBeenCalledWith(["second", "second"], 0.75);
  },
};

export const SinglePane: Story = {
  args: { node: { type: "pane", id: "map", content: { type: "component", componentId: "map" } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("map")).toBeVisible();
    await expect(canvas.queryByRole("slider")).toBeNull();
  },
};
