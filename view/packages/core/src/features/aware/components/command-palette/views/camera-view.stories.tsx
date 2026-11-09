import { accessibleName } from "@hydris/ui/storybook/queries";
import { ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  DOCK_ERROR,
  dockCamera,
  gateCamera,
  simcamService,
} from "../../../../../storybook/cameras";
import { withSchema } from "../../../../../storybook/config";
import { camera, CONFIG_SCHEMA, detection, webrtc } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { cameraInPane, coreProviders } from "../../../../../storybook/providers";
import { seedEntities } from "../../../../../storybook/seed";
import { CameraView } from "./camera-view";

const LENS_ERROR = "lens heater offline";

const STREAM_NAMES = /^(Main|CAM-2|Thermal)$/;

const setUp = { config: { value: { fov_wide: 60 }, version: 1n } };

const cameras = [
  simcamService,
  withSchema(gateCamera, CONFIG_SCHEMA),
  dockCamera(ConfigurableState.ConfigurableStateFailed, DOCK_ERROR),
  camera("simcam-4", [], {
    label: "Mast camera",
    device: {
      parent: "simcam.service",
      class: "camera",
      state: DeviceState.DeviceStateActive,
      error: LENS_ERROR,
    },
    configurable: { state: ConfigurableState.ConfigurableStateActive },
    ...setUp,
  }),
  camera(
    "simcam-3",
    [
      webrtc("Main", "/whep/simcam-3"),
      webrtc("", "/whep/simcam-3-sub"),
      webrtc("Thermal", "/whep/simcam-3-thermal"),
    ],
    {
      label: "Quay camera",
      device: { parent: "simcam.service", class: "camera", state: DeviceState.DeviceStateActive },
      configurable: { state: ConfigurableState.ConfigurableStateActive },
      ...setUp,
    },
  ),
  detection("det-1", "simcam-3", {
    label: "Drone",
    detection: {
      detectorEntityId: "simcam-3",
      confidence: 0.82,
      imageBbox: { x: 100, y: 60, width: 60, height: 40, frameWidth: 320, frameHeight: 180 },
    },
  }),
];

const meta = {
  title: "Core/Aware/Command palette/Views/CameraView",
  component: CameraView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { entityId: "simcam-1", dispatch: fn() },
  beforeEach: () => seedEntities(cameras, { isConnected: true }),
  decorators: [paletteView({ keyboard: false }), coreProviders()],
} satisfies Meta<typeof CameraView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, step }) => {
    await step("a camera without a stream says so", async () => {
      await expect(canvas.getByText("No stream")).toBeVisible();
    });

    await step("a set-up camera offers only Config, which opens its settings", async () => {
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual(["Config"]);

      await userEvent.click(canvas.getByRole("button", { name: "Config" }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "settings", entityId: "simcam-1" },
      });
    });
  },
};

export const FailedShowsError: Story = {
  args: { entityId: "simcam-2" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.getByRole("alert")).toHaveTextContent(DOCK_ERROR);
  },
};

export const DeviceErrorOnRunningCamera: Story = { args: { entityId: "simcam-4" } };

export const EveryStream: Story = {
  args: { entityId: "simcam-3" },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas, step }) => {
    await step("one entry per stream, labelled as sent or numbered", async () => {
      await expect(
        (await canvas.findAllByRole("group", { name: STREAM_NAMES })).map(accessibleName),
      ).toEqual(["Main", "CAM-2", "Thermal"]);
    });

    await step("detections draw on the first stream", async () => {
      const main = canvas.getByRole("group", { name: "Main" });

      await expect(await within(main).findByText("Drone 82%")).toBeVisible();
    });

    await step("only the stream in view plays, and plays again when scrolled back", async () => {
      const main = canvas.getByRole("group", { name: "Main" });
      const thermal = canvas.getByRole("group", { name: "Thermal" });

      await expect(await within(main).findByText("Connecting…")).toBeVisible();
      await expect(within(thermal).queryByText("Connecting…")).toBeNull();

      thermal.scrollIntoView();
      await waitFor(() => expect(within(thermal).getByText("Connecting…")).toBeVisible());
      await expect(within(main).queryByText("Connecting…")).toBeNull();

      main.scrollIntoView();
      await waitFor(() => expect(within(main).getByText("Connecting…")).toBeVisible());
    });
  },
};

export const StreamShownInPane: Story = {
  args: { entityId: "simcam-3" },
  parameters: { a11y: { test: "todo" } },
  decorators: [cameraInPane("simcam-3")],
  play: async ({ canvas }) => {
    const main = await canvas.findByRole("group", { name: "Main" });

    await expect(await within(main).findByText("Viewing in Pane")).toBeVisible();
    await expect(within(main).queryByText("Connecting…")).toBeNull();
  },
};

export const RemovedWhileOpen: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("simcam-1")).toBeVisible();

    seedEntities(
      cameras.filter((e) => e.id !== "simcam-1"),
      { isConnected: true },
    );
    await expect(await canvas.findByText("Camera no longer exists")).toBeVisible();
    await expect(canvas.queryByText("simcam-1")).toBeNull();
  },
};

export const SetupRemovedWhileOpen: Story = {
  play: async ({ args, canvas, step }) => {
    await expect(canvas.getByText("No stream")).toBeVisible();

    await step("the page offers setup in place of the stream", async () => {
      seedEntities(
        cameras.map((e) => (e.id === "simcam-1" ? { ...e, config: undefined } : e)),
        { isConnected: true },
      );
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: /Set up camera/ })).toBeVisible(),
      );
      await expect(canvas.queryByText("No stream")).toBeNull();
    });

    await step("pressing it opens the setup", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /Set up camera/ }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "setup", entityId: "simcam-1" },
      });
    });

    await step("Enter on the highlighted tile opens the setup", async () => {
      await userEvent.keyboard("{ArrowDown}{Enter}");
      await expect(args.dispatch).toHaveBeenCalledTimes(2);
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "setup", entityId: "simcam-1" },
      });
    });
  },
};
