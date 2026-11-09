import type { Canvas } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { StreamPreviewContext } from "./connection-overlay";
import { ImageStream } from "./image-stream";

const meta = {
  title: "Core/Aware/Video stream/ImageStream",
  component: ImageStream,
  args: { url: "/fixtures/camera-frame.jpg" },
  decorators: [
    (Story) => (
      <View className="h-56 w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ImageStream>;

export default meta;

type Story = StoryObj<typeof meta>;

const LOAD = { timeout: 5000 };

function refreshButton(canvas: Canvas) {
  return canvas.findByRole("button", { name: "Refresh image" }, LOAD);
}

function frame(canvas: Canvas) {
  const src = canvas.getByRole("img", { name: "Image stream" }).getAttribute("src");

  return Number(new URL(src ?? "", location.href).searchParams.get("_t"));
}

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await refreshButton(canvas)).toBeVisible();
    await expect(canvas.queryByText("Connecting…")).toBeNull();
  },
};

export const Contain: Story = {
  args: { objectFit: "contain" },
  play: async ({ canvas }) => {
    await refreshButton(canvas);
  },
};

export const InvalidSource: Story = {
  args: { url: "fixtures/camera-frame.jpg" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Invalid image source")).toBeVisible();
    await expect(canvas.queryByRole("img")).toBeNull();
  },
};

export const LoadFailed: Story = {
  args: { url: "/fixtures/missing-frame.jpg" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Failed to load image", {}, LOAD)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Refresh image" })).toBeNull();
  },
};

export const RetriesAfterFailure: Story = {
  args: { url: "/fixtures/missing-frame.jpg" },
  play: async ({ canvas }) => {
    await canvas.findByText("Failed to load image", {}, LOAD);

    await userEvent.click(canvas.getByRole("button", { name: "Retry connection" }));
    await expect(await canvas.findByText("Connecting…")).toBeVisible();
    await expect(await canvas.findByText("Failed to load image", {}, LOAD)).toBeVisible();
  },
};

export const Refreshes: Story = {
  play: async ({ canvas }) => {
    const refresh = await refreshButton(canvas);
    const shown = frame(canvas);

    await userEvent.click(refresh);
    await waitFor(() => expect(frame(canvas)).toBe(shown + 1));
  },
};

const reportStatus = fn();

export const InPreview: Story = {
  decorators: [
    (Story) => (
      <StreamPreviewContext value={reportStatus}>
        <Story />
      </StreamPreviewContext>
    ),
  ],
  play: async ({ canvas }) => {
    await waitFor(
      () => expect(reportStatus).toHaveBeenLastCalledWith({ state: "connected", error: null }),
      LOAD,
    );
    await expect(canvas.getByRole("img", { name: "Image stream" })).toBeVisible();
    await expect(canvas.queryAllByRole("button")).toEqual([]);
  },
};
