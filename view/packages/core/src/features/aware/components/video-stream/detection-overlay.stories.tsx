import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Image, View } from "react-native";
import { expect } from "storybook/test";

import { detection } from "../../../../storybook/entities";
import { seedEntities } from "../../../../storybook/seed";
import { DetectionOverlay } from "./detection-overlay";

type Box = { x: number; y: number; width: number; height: number };

const FIXTURE_FRAME_SIZE = { frameWidth: 320, frameHeight: 180 };

function boxed(
  id: string,
  cameraId: string,
  label: string | undefined,
  box: Box,
  confidence?: number,
) {
  return detection(id, cameraId, {
    label,
    detection: {
      detectorEntityId: cameraId,
      confidence,
      imageBbox: { ...box, ...FIXTURE_FRAME_SIZE },
    },
  });
}

const drone = boxed("det-1", "cam-1", "Drone", { x: 100, y: 60, width: 60, height: 40 }, 0.82);

const meta = {
  title: "Core/Aware/Video stream/DetectionOverlay",
  component: DetectionOverlay,
  tags: ["!autodocs"],
  args: { cameraEntityId: "cam-1" },
  decorators: [
    (Story, { args }) => (
      <View className="relative h-60 w-80 bg-black">
        <Image
          accessibilityLabel="Camera frame"
          source={{ uri: "fixtures/camera-frame.jpg" }}
          resizeMode={args.objectFit ?? "cover"}
          className="absolute inset-0"
        />
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof DetectionOverlay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () =>
    seedEntities([
      drone,
      boxed("det-2", "cam-1", "Person", { x: 210, y: 90, width: 30, height: 70 }, 0.64),
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Drone 82%")).toBeVisible();
    await expect(canvas.getByText("Person 64%")).toBeVisible();
  },
};

export const Contain: Story = {
  args: { objectFit: "contain" },
  beforeEach: () => seedEntities([drone]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Drone 82%")).toBeVisible();
  },
};

export const LabelBelowBoxAtTopEdge: Story = {
  beforeEach: () =>
    seedEntities([
      boxed("det-3", "cam-1", "Vehicle", { x: 140, y: 3, width: 80, height: 30 }, 0.91),
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Vehicle 91%")).toBeVisible();
  },
};

export const WithoutConfidence: Story = {
  beforeEach: () =>
    seedEntities([boxed("det-4", "cam-1", "Person", { x: 90, y: 70, width: 30, height: 70 })]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Person")).toBeVisible();
  },
};

export const WithoutLabel: Story = {
  beforeEach: () =>
    seedEntities([
      boxed("det-5", "cam-1", undefined, { x: 90, y: 70, width: 30, height: 70 }, 0.5),
    ]),
};

export const SkipsDetectionsItCannotPlace: Story = {
  beforeEach: () =>
    seedEntities([
      drone,
      detection("det-6", "cam-1", { label: "No box" }),
      boxed("det-7", "cam-2", "Other camera", { x: 20, y: 20, width: 40, height: 40 }, 0.7),
    ]),
  play: async ({ canvas }) => {
    await canvas.findByText("Drone 82%");

    await expect(canvas.queryByText(/No box/)).toBeNull();
    await expect(canvas.queryByText(/Other camera/)).toBeNull();
  },
};
