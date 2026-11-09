import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { MiddleTruncateText } from "./middle-truncate-text";

const meta = {
  title: "UI/Text and data/MiddleTruncateText",
  component: MiddleTruncateText,
  args: { text: "TANGO 21", className: "text-foreground font-sans text-sm" },
} satisfies Meta<typeof MiddleTruncateText>;

export default meta;

type Story = StoryObj<typeof meta>;

// unlike textContent, innerText leaves out a space the browser collapsed and puts a line break between parts
function renderedText(root: HTMLElement): string {
  return root.innerText.replace(/\n/g, "").replace(/\s/g, " ");
}

export const Default: Story = {};

export const LongTextInNarrowContainer: Story = {
  args: {
    text: "3f2b9c4e-7a1d-4e8b-9f60-2c5d8a7e1b34",
    className: "text-foreground font-mono text-xs",
  },
  decorators: [
    (Story) => (
      <View className="w-56">
        <Story />
      </View>
    ),
  ],
};

export const ShortTextInNarrowContainer: Story = {
  args: { text: "Demo detection" },
  decorators: [
    (Story) => (
      <View className="w-14">
        <Story />
      </View>
    ),
  ],
  play: async ({ canvas }) => {
    const text = canvas.getByText("Demo detection");
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight);

    await expect(text.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
  },
};

export const EvenSplit: Story = {
  args: {
    text: "North quay berth 4 behind the fuel pier, gate C",
    evenSplit: true,
    className: "text-foreground font-mono text-xs",
  },
  decorators: [
    (Story) => (
      <View className="w-24">
        <Story />
      </View>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent(
      /^North quay berth 4 behind the fuel pier, gate C$/,
    );
  },
};

export const CustomTailLength: Story = {
  args: {
    text: "perimeter-station-04-thermal-capture-2026-10-09.mp4",
    tailLength: 9,
    className: "text-foreground font-mono text-xs uppercase",
  },
  decorators: LongTextInNarrowContainer.decorators,
};

export const SpaceAtSplit: Story = {
  args: {
    text: "summary of findings",
    tailLength: 9,
    className: "text-foreground font-mono text-xs",
  },
  play: async ({ canvasElement }) => {
    await expect(renderedText(canvasElement)).toBe("summary of findings");
  },
};

export const SpaceBeforeSplit: Story = {
  args: { ...SpaceAtSplit.args, tailLength: 8 },
  play: SpaceAtSplit.play,
};

export const EmojiAtSplit: Story = {
  args: { ...SpaceAtSplit.args, text: "gate video 📷 gate 12" },
  play: async ({ canvasElement }) => {
    const walker = document.createTreeWalker(canvasElement, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      parts.push(node.textContent ?? "");
    }

    await expect(parts.filter((part) => !part.isWellFormed())).toEqual([]);
  },
};

export const EvenSplitAtSpace: Story = {
  args: {
    text: "summary of findings",
    evenSplit: true,
    className: "text-foreground font-mono text-xs",
  },
  play: SpaceAtSplit.play,
};

export const EndingOnlyInNarrowContainer: Story = {
  args: {
    text: "3f2b9c4e-7a1d-4e8b-9f60-2c5d8a7e1b34",
    className: "text-foreground font-mono text-xs",
  },
  decorators: [
    (Story) => (
      <View testID="box" className="w-14">
        <Story />
      </View>
    ),
  ],
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("…")).toBeVisible();

    const box = canvas.getByTestId("box").getBoundingClientRect();
    const text = canvas.getByText("3f2b9c4e-7a1d-4e8b-9f60-2c5d8a7e1b34").getBoundingClientRect();

    await expect(Math.abs(text.right - box.right)).toBeLessThan(1);
  },
};
