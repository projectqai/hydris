import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { expect, fn, waitFor } from "storybook/test";

import { ScrollShadow } from "./scroll-shadow";

const CAMERAS = Array.from({ length: 14 }, (_, i) => `Gate camera ${i + 1}`);

const onScroll = fn().mockName("onScroll");
const onLayout = fn().mockName("onLayout");

function Row({ label }: { label: string }) {
  return (
    <Pressable role="button" className="border-surface-overlay/6 border-b px-4 py-3">
      <Text className="text-foreground font-sans text-sm">{label}</Text>
    </Pressable>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <Pressable role="button" className="bg-surface-overlay/6 mr-2 rounded px-3 py-2">
      <Text className="text-foreground font-sans text-sm">{label}</Text>
    </Pressable>
  );
}

function list(labels: string[]) {
  return (
    <FlatList
      testID="scrollable"
      data={labels}
      keyExtractor={(label) => label}
      renderItem={({ item }) => <Row label={item} />}
      onScroll={onScroll}
      onLayout={onLayout}
      className="flex-1"
    />
  );
}

const SCROLLABLES = {
  "Overflowing list": list(CAMERAS),
  "Fitting list": list(CAMERAS.slice(0, 3)),
  "Horizontal row": (
    <ScrollView
      horizontal
      testID="scrollable"
      onScroll={onScroll}
      onLayout={onLayout}
      contentContainerClassName="items-center p-4"
    >
      {CAMERAS.map((label) => (
        <Chip key={label} label={label} />
      ))}
    </ScrollView>
  ),
};

const meta = {
  title: "UI/Containers and surfaces/ScrollShadow",
  component: ScrollShadow,
  args: { className: "flex-1", children: SCROLLABLES["Overflowing list"] },
  argTypes: {
    children: { control: "radio", options: Object.keys(SCROLLABLES), mapping: SCROLLABLES },
    visibility: { control: "radio", options: ["auto", "start", "end", "both"] },
    size: { control: "radio", options: ["sm", "default", "lg"] },
    className: { control: "text" },
  },
  decorators: [
    (Story) => (
      <View className="bg-card h-60 w-[560px] rounded">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ScrollShadow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, step }) => {
    await step("the child keeps its layout handler", async () => {
      await waitFor(() => expect(onLayout).toHaveBeenCalled());
    });

    await step("the child keeps its scroll handler", async () => {
      const scrollable = canvas.getByTestId("scrollable");

      scrollable.scrollTop = 137;
      scrollable.dispatchEvent(new Event("scroll"));

      await waitFor(() =>
        expect(onScroll).toHaveBeenCalledWith(
          expect.objectContaining({
            nativeEvent: expect.objectContaining({ contentOffset: { x: 0, y: 137 } }),
          }),
        ),
      );
    });
  },
};

export const Horizontal: Story = { args: { children: SCROLLABLES["Horizontal row"] } };

export const StartEdgeForced: Story = { args: { visibility: "start" } };

export const EndEdgeForced: Story = {
  args: { children: SCROLLABLES["Fitting list"], visibility: "end" },
};

export const BothEdgesForced: Story = {
  args: { children: SCROLLABLES["Fitting list"], visibility: "both" },
};

export const Small: Story = { args: { size: "sm" } };

export const Large: Story = { args: { size: "lg" } };

export const Disabled: Story = { args: { disabled: true } };
