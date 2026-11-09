import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, mocked, screen, userEvent } from "storybook/test";

import { downloadFromEndpoint } from "../../../../lib/download";
import { artifact } from "../../../../storybook/entities";
import { downloadNeverFinishes } from "../../../../storybook/requests";
import { ArtifactRow } from "./artifact-row";

const meta = {
  title: "Core/Aware/Entity details/ArtifactRow",
  component: ArtifactRow,
  argTypes: {
    entity: { control: false },
    resolution: { control: false },
    error: { control: "text" },
  },
  args: {
    entity: artifact("clip-1", "image/jpeg", 482_133n, { label: "Frame 0412" }),
    expanded: false,
    playing: false,
    initialPosition: 0,
    error: null,
    onToggleExpanded: fn(),
    onTogglePlayback: fn(),
    onPositionCommit: fn(),
    onPlaybackStopped: fn(),
    onError: fn(),
    onClearError: fn(),
  },
  parameters: { a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ArtifactRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("image/jpeg · 482.1 kB")).toBeVisible();
  },
};

export const Video: Story = {
  args: { entity: artifact("clip-2", "video/mp4", 18_400_000n, { label: "Gate approach" }) },
};

export const Audio: Story = {
  args: { entity: artifact("clip-3", "audio/ogg", 96_000n, { label: "Radio recording" }) },
};

export const Document: Story = {
  args: { entity: artifact("doc-1", "application/pdf", 640n, { label: "Patrol report" }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("application/pdf · 640 B")).toBeVisible();
  },
};

export const LongNameInNarrowContainer: Story = {
  args: {
    entity: artifact("clip-4", "image/jpeg", 482_133n, {
      label: "north-perimeter-gate-camera-frame-20261009-0412",
    }),
  },
  decorators: [
    (Story) => (
      <View className="w-56">
        <Story />
      </View>
    ),
  ],
};

export const Loading: Story = {
  args: { resolution: { status: "loading" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading…")).toBeVisible();
  },
};

export const Failed: Story = {
  args: { resolution: { status: "failed", onRetry: fn() } },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Expand Frame 0412, load failed" }),
    ).toBeVisible();
  },
};

export const MissingContentType: Story = {
  args: { entity: artifact("blob-1", "", 2_048n, { label: "Unnamed upload" }) },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Expand Unnamed upload, load failed" }),
    ).toBeVisible();
    await expect(canvas.getByText("2.0 kB")).toBeVisible();
  },
};

export const Expands: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Expand Frame 0412" }));
    await expect(args.onToggleExpanded).toHaveBeenCalledOnce();
    await expect(args.onToggleExpanded).toHaveBeenCalledWith("clip-1");
  },
};

export const ExpandedDocument: Story = {
  args: {
    expanded: true,
    entity: artifact("doc-1", "application/pdf", 640n, {
      label: "Patrol report",
      artifact: {
        contentType: "application/pdf",
        sizeBytes: 640n,
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("9f86d...00a08")).toBeVisible();
    await expect(canvas.getByLabelText("Download artifact")).toBeVisible();
  },
};

export const DownloadFails: Story = {
  args: ExpandedDocument.args,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Download artifact"));
    await expect(
      await screen.findByText("downloadFromEndpoint called from a story"),
    ).toBeInTheDocument();
  },
};

export const Downloads: Story = {
  args: ExpandedDocument.args,
  beforeEach: () => {
    mocked(downloadFromEndpoint).mockResolvedValue();
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Download artifact"));
    await expect(await screen.findByText("Sent to downloads")).toBeInTheDocument();
    await expect(downloadFromEndpoint).toHaveBeenCalledWith({
      url: "http://storybook.invalid/artifacts/doc-1",
      method: "GET",
      mimeType: "application/pdf",
      parentFolder: "Hydris-Artifacts",
      fallbackFilename: "doc-1",
    });
  },
};

export const Downloading: Story = {
  args: ExpandedDocument.args,
  beforeEach: downloadNeverFinishes,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Download artifact"));
    await expect(await canvas.findByText("Downloading…")).toBeVisible();
  },
};

export const ExpandedLoading: Story = {
  args: { expanded: true, resolution: { status: "loading" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading artifact…")).toBeVisible();
  },
};

const onRetry = fn();

export const ExpandedFailedRetries: Story = {
  args: { expanded: true, resolution: { status: "failed", onRetry } },
  beforeEach: () => {
    onRetry.mockClear();
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Artifact could not be loaded")).toBeVisible();

    await userEvent.click(canvas.getByText("Retry"));
    await expect(onRetry).toHaveBeenCalledOnce();
  },
};

export const ExpandedLoadErrorRetries: Story = {
  args: {
    expanded: true,
    error: "Failed to load image",
  },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Failed to load image")).toBeVisible();

    await userEvent.click(canvas.getByText("Retry"));
    await expect(args.onClearError).toHaveBeenCalledOnce();
    await expect(args.onClearError).toHaveBeenCalledWith("clip-1");
  },
};

export const ExpandedAudioErrorRetries: Story = {
  args: {
    expanded: true,
    entity: artifact("clip-3", "audio/ogg", 96_000n, { label: "Radio recording" }),
    error: "Failed to load audio",
  },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Failed to load audio")).toBeVisible();

    await userEvent.click(canvas.getByText("Retry"));
    await expect(args.onClearError).toHaveBeenCalledWith("clip-3");
    await expect(args.onTogglePlayback).toHaveBeenCalledOnce();
    await expect(args.onTogglePlayback).toHaveBeenCalledWith("clip-3");
  },
};

export const ExpandedMissingContentType: Story = {
  args: {
    expanded: true,
    entity: artifact("blob-1", "", 2_048n, { label: "Unnamed upload" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Artifact content type is missing")).toBeVisible();
    await expect(canvas.queryByText("Retry")).toBeNull();
  },
};
