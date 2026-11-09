import type { Entity } from "@projectqai/proto/world";
import { ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { DOCK_ERROR, dockCamera, gateCamera, simcamService } from "../../../storybook/cameras";
import { camera, entity, notSetUpCameraService, setUpCamera } from "../../../storybook/entities";
import { seedEntities } from "../../../storybook/seed";
import { isDeviceRoot } from "../sources";
import { ServiceTile } from "./service-tile";

function service(e: Entity) {
  if (!isDeviceRoot(e)) throw new Error(`${e.id} needs a device without a parent to be a service`);

  return e;
}

const cameraDebugger = service(simcamService);

const fourDevices = [
  cameraDebugger,
  gateCamera,
  dockCamera(ConfigurableState.ConfigurableStateFailed),
  entity("simcam-recorder", {
    label: "Yard recorder",
    device: {
      parent: "simcam.service",
      category: "Cameras",
      state: DeviceState.DeviceStateActive,
    },
  }),
  camera("simcam-recorder-1", [], {
    label: "Yard channel",
    device: {
      parent: "simcam-recorder",
      category: "Cameras",
      state: DeviceState.DeviceStateDegraded,
    },
  }),
];

const meta = {
  title: "Core/Mission/ServiceTile",
  component: ServiceTile,
  tags: ["!autodocs"],
  args: { serviceId: cameraDebugger.id, onPress: fn(), highlighted: false },
  argTypes: { serviceId: { control: false } },
  parameters: { layout: "centered" },
  beforeEach: () => seedEntities([cameraDebugger, gateCamera], { isConnected: true }),
  decorators: [
    (Story) => (
      <View className="h-[198px] w-[270px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ServiceTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Camera Debugger/ }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const ListsDirectChildrenMostSevereFirst: Story = {
  beforeEach: () => seedEntities(fourDevices, { isConnected: true }),
  play: async ({ canvas, step }) => {
    const tile = () => canvas.getByRole("button", { name: /^Camera Debugger/ });

    await step("each direct child is one row, raised by a device below it", async () => {
      await expect(tile()).toHaveTextContent(
        /^Camera DebuggerFailedDock cameraFailedYard recorderDegradedGate cameraActive$/,
      );
    });

    await step("the hidden count takes the word of its most severe device", async () => {
      seedEntities(
        [
          ...fourDevices,
          setUpCamera(
            "simcam-3",
            "Quay camera",
            "simcam.service",
            ConfigurableState.ConfigurableStateStarting,
          ),
          setUpCamera(
            "simcam-4",
            "Pier camera",
            "simcam.service",
            ConfigurableState.ConfigurableStateConflict,
          ),
        ],
        { isConnected: true },
      );
      await waitFor(() =>
        expect(tile()).toHaveTextContent(
          /^Camera DebuggerConflictPier cameraConflictDock cameraFailedYard recorderDegraded\+2 moreStarting$/,
        ),
      );
    });
  },
};

export const FailingCamera: Story = {
  beforeEach: () =>
    seedEntities(
      [
        cameraDebugger,
        setUpCamera(
          "simcam-1",
          "Gate camera",
          "simcam.service",
          ConfigurableState.ConfigurableStateStarting,
          "warming up",
        ),
        dockCamera(ConfigurableState.ConfigurableStateFailed, DOCK_ERROR),
      ],
      { isConnected: true },
    ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Camera Debugger/ })).toHaveTextContent(
      /^Camera DebuggerFailedDock cameraFailedGate cameraStarting$/,
    );
  },
};

const wildlifeCameras = service(notSetUpCameraService("wildlife.service", "Wildlife cameras"));

export const NeverSetUp: Story = {
  args: { serviceId: wildlifeCameras.id },
  beforeEach: () => seedEntities([wildlifeCameras], { isConnected: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Wildlife cameras/ })).toHaveTextContent(
      /^Wildlife camerasWildlife cameras$/,
    );
  },
};
