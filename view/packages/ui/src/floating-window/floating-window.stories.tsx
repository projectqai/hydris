import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Platform, Text, View } from "react-native";
import { expect, fn, waitFor } from "storybook/test";

import { center, drag } from "../storybook/pointer";
import { screenLocked } from "../storybook/screen-lock";
import { FloatingWindow } from "./floating-window";

function Bar({ children }: { children: string }) {
  return (
    <View className="px-3 py-2">
      <Text className="font-sans-medium text-13 text-foreground">{children}</Text>
    </View>
  );
}

const meta = {
  title: "UI/Containers and surfaces/FloatingWindow",
  component: FloatingWindow,
  args: {
    isVisible: true,
    config: { defaultWidth: 360, defaultHeight: 220 },
    initialPosition: { x: 40, y: 40 },
    header: "Title",
    content: "Placeholder",
    onPositionChange: fn(),
  },
  argTypes: {
    header: {
      control: "select",
      options: ["None", "Title"],
      mapping: { None: undefined, Title: <Bar>Camera 04 (drag to move)</Bar> },
    },
    content: {
      control: "select",
      options: ["None", "Placeholder"],
      mapping: {
        None: undefined,
        Placeholder: (
          <View className="flex-1 items-center justify-center">
            <Text className="text-11 font-mono text-white/60">content area is always black</Text>
          </View>
        ),
      },
    },
    footer: {
      control: "select",
      options: ["None", "Footer"],
      mapping: { None: undefined, Footer: <Bar>Footer</Bar> },
    },
  },
  decorators: [
    (Story) => (
      <View className="border-border native:flex-1 h-80 w-[480px] overflow-hidden rounded-md border">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof FloatingWindow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HeaderAndFooterWithoutContent: Story = {
  args: { content: "None", footer: "Footer", config: { defaultWidth: 280, defaultHeight: 150 } },
};

export const Hidden: Story = {
  args: { isVisible: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Camera 04 (drag to move)")).toBeNull();
  },
};

export const DragsByHeader: Story = {
  play: async ({ args, canvas }) => {
    const header = center(await canvas.findByText("Camera 04 (drag to move)"));
    const start = { ...header, clientX: header.clientX + 30 };

    await drag(
      header,
      { clientX: start.clientX + 60, clientY: start.clientY + 15 },
      { moveFrom: start },
    );
    await waitFor(() => expect(args.onPositionChange).toHaveBeenCalledWith({ x: 100, y: 55 }));
  },
};

export const ResizesFromRightEdge: Story = {
  play: async ({ canvas }) => {
    const content = await canvas.findByText("content area is always black");
    const title = canvas.getByText("Camera 04 (drag to move)");
    const before = center(content);
    const left = title.getBoundingClientRect().left;
    const edge = { clientX: before.clientX + 360 / 2 - 4, clientY: before.clientY };
    const start = { ...edge, clientY: edge.clientY + 30 };

    await drag(edge, { ...start, clientX: start.clientX + 40 }, { moveFrom: start });

    await waitFor(() => expect(center(content).clientX).toBeCloseTo(before.clientX + 20, 0));
    await expect(title.getBoundingClientRect().left).toBeCloseTo(left, 0);
    await expect(center(content).clientY).toBeCloseTo(before.clientY, 0);
  },
};

export const ResizesFromLeftEdge: Story = {
  play: async ({ canvas }) => {
    const content = await canvas.findByText("content area is always black");
    const title = canvas.getByText("Camera 04 (drag to move)");
    const before = center(content);
    const left = title.getBoundingClientRect().left;
    const edge = { clientX: before.clientX - 360 / 2 + 4, clientY: before.clientY };
    const start = { ...edge, clientY: edge.clientY + 30 };

    await drag(edge, { ...start, clientX: start.clientX - 20 }, { moveFrom: start });

    await waitFor(() => expect(center(content).clientX).toBeCloseTo(before.clientX - 10, 0));
    await expect(title.getBoundingClientRect().left).toBeCloseTo(left - 20, 0);
    await expect(center(content).clientY).toBeCloseTo(before.clientY, 0);
  },
};

export const DragsByFooter: Story = {
  args:
    Platform.OS === "web"
      ? { footer: "Footer" }
      : {
          footer: "Footer",
          initialPosition: { x: 40, y: 16 },
          config: { defaultWidth: 360, defaultHeight: 180 },
        },
  play: async ({ args, canvas }) => {
    const footer = center(await canvas.findByText("Footer"));
    const start = { ...footer, clientX: footer.clientX + 30 };

    await drag(
      footer,
      { clientX: start.clientX + 60, clientY: start.clientY - 15 },
      { moveFrom: start },
    );
    await waitFor(() => expect(args.onPositionChange).toHaveBeenCalledWith({ x: 100, y: 25 }));
  },
};

export const ScreenLocked: Story = {
  decorators: [screenLocked],
  play: async ({ args, canvas }) => {
    const title = await canvas.findByText("Camera 04 (drag to move)");
    const header = center(title);
    const start = { ...header, clientX: header.clientX + 30 };

    await drag(
      header,
      { clientX: start.clientX + 60, clientY: start.clientY + 15 },
      { moveFrom: start },
    );
    await expect(args.onPositionChange).not.toHaveBeenCalled();

    const content = canvas.getByText("content area is always black");
    const before = center(content);
    const edge = { clientX: before.clientX + 360 / 2 - 4, clientY: before.clientY };
    const edgeStart = { ...edge, clientY: edge.clientY + 30 };

    await drag(edge, { ...edgeStart, clientX: edgeStart.clientX + 40 }, { moveFrom: edgeStart });
    await expect(center(content).clientX).toBeCloseTo(before.clientX, 0);
  },
};
