import { ConfigurableState, DeviceState, MediaStreamProtocol } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  cameraAwaitingSetup,
  DOCK_ERROR,
  dockCamera,
  gateCamera,
} from "../../../storybook/cameras";
import { camera, webrtc } from "../../../storybook/entities";
import { coreProviders } from "../../../storybook/providers";
import { seedEntities } from "../../../storybook/seed";
import { CameraTile } from "./camera-tile";

const parent = { parent: "simcam.service", class: "camera" };

const setUp = { config: { value: { fov_wide: 60 }, version: 1n } };

const webrtcStream = webrtc("Main", "/whep/simcam-3");

const meta = {
  title: "Core/Mission/CameraTile",
  component: CameraTile,
  tags: ["!autodocs"],
  args: { camera: gateCamera, onPress: fn(), highlighted: false },
  argTypes: { camera: { control: false } },
  parameters: { layout: "centered" },
  beforeEach: () => seedEntities([], { isConnected: true }),
  decorators: [
    (Story) => (
      <View className="h-[198px] w-[270px]">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof CameraTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Gate camera/ }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const AwaitingSetup: Story = {
  args: { camera: cameraAwaitingSetup() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Set up")).toBeVisible();
  },
};

export const Starting: Story = {
  args: {
    camera: camera("simcam-1", [], {
      label: "Gate camera",
      device: { ...parent, state: DeviceState.DeviceStateActive },
      configurable: { state: ConfigurableState.ConfigurableStateStarting, error: "warming up" },
      ...setUp,
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Starting")).toBeVisible();
    await expect(canvas.queryByText("warming up")).toBeNull();
  },
};

export const Failed: Story = {
  args: { camera: dockCamera(ConfigurableState.ConfigurableStateFailed, DOCK_ERROR) },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Dock camera/ })).toHaveTextContent(
      /^Dock cameraFailedFailed$/,
    );
  },
};

export const StreamConnecting: Story = {
  args: {
    camera: camera("simcam-3", [webrtcStream], {
      label: "Quay camera",
      device: { ...parent, state: DeviceState.DeviceStateActive },
      configurable: { state: ConfigurableState.ConfigurableStateActive },
      ...setUp,
    }),
  },
  play: async ({ canvas }) => {
    const card = canvas.getByRole("button", { name: /^Quay camera/ });

    await expect(await within(card).findByText("Connecting…")).toBeVisible();
  },
};

export const StreamFailed: Story = {
  args: {
    camera: camera(
      "simcam-4",
      [
        {
          label: "Snapshot",
          url: "/snapshot.jpg",
          protocol: MediaStreamProtocol.MediaStreamProtocolImage,
        },
      ],
      {
        label: "Mast camera",
        device: { ...parent, state: DeviceState.DeviceStateActive },
        configurable: { state: ConfigurableState.ConfigurableStateActive },
        ...setUp,
      },
    ),
  },
  play: async ({ canvas }) => {
    const card = canvas.getByRole("button", { name: /^Mast camera/ });

    await expect(
      await within(card).findByText("Failed to load image", {}, { timeout: 5_000 }),
    ).toBeVisible();
    await expect(within(card).queryAllByRole("button")).toEqual([]);
  },
};

export const FailedWithStream: Story = {
  args: {
    camera: camera("simcam-3", [webrtcStream], {
      label: "Quay camera",
      device: { ...parent, state: DeviceState.DeviceStateFailed, error: "lens heater offline" },
      ...setUp,
    }),
  },
  play: async ({ canvas }) => {
    const card = canvas.getByRole("button", { name: /^Quay camera/ });

    await within(card).findByText("Connecting…");
    await expect(card).toHaveTextContent(/^Quay cameraFailedConnecting…$/);
  },
};
