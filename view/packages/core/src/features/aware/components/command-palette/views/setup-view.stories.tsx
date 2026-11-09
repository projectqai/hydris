import type { JsonObject } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { Canvas } from "@hydris/ui/storybook/queries";
import { accessibleName, shownAlertDialog, toasts, wholeText } from "@hydris/ui/storybook/queries";
import {
  ConfigurableState,
  DeviceState,
  EntityChangeResponseSchema,
  ExpireEntityResponseSchema,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, mocked, screen, userEvent, waitFor, within } from "storybook/test";

import { worldClient } from "../../../../../lib/api/world-client";
import {
  axisService,
  cameraAwaitingSetup,
  wildlifeService,
} from "../../../../../storybook/cameras";
import { elapseHeldTimeouts, holdTimeouts } from "../../../../../storybook/clock";
import { answeredWith, streamSchema, WAITING } from "../../../../../storybook/config";
import { entity } from "../../../../../storybook/entities";
import { coreProviders } from "../../../../../storybook/providers";
import { acceptPushes } from "../../../../../storybook/requests";
import { seedEntities } from "../../../../../storybook/seed";
import { sensorServiceNotSetUp } from "../../../../../storybook/sensors";
import { HANDSHAKE_TIMEOUT_MS } from "../../../hooks/use-config-handshake";
import { SetupView } from "./setup-view";

const GROUPED_CAMERA_SCHEMA: JsonObject = {
  type: "object",
  "ui:groups": [
    { key: "stream", title: "Stream" },
    { key: "connection", title: "Connection" },
  ],
  required: ["fps"],
  properties: {
    host: { type: "string", title: "Host", "ui:group": "connection" },
    fps: { type: "integer", title: "Frame rate", minimum: 1, maximum: 30, "ui:group": "stream" },
    enable_direct_drive: {
      type: "boolean",
      title: "Direct Drive",
      "ui:dangerous": true,
      "ui:confirm": "Joystick input will move the camera.",
    },
  },
};

const UNGROUPED_CAMERA_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    host: { type: "string", title: "Host" },
    fps: { type: "integer", title: "Frame rate" },
  },
};

const LONG_STREAM_SCHEMA = streamSchema({ key: "stream", title: "Stream" });

const AXIS_CAMERA = "axis.device.10_0_4_17";

const ADDED_CAMERA = "axis.service.camera.0a1b2c3d";

const PROBE_ERROR =
  "Probe failed: TLS handshake with Cam-04.local:443 rejected the certificate chain, " +
  "check the camera's clock and its installed CA bundle";

const axisCameras = axisService();

const axisCamera = cameraAwaitingSetup(GROUPED_CAMERA_SCHEMA);

const addedCamera = entity(ADDED_CAMERA, {
  device: { parent: "axis.service", class: "camera" },
  configurable: { label: "Camera", schema: UNGROUPED_CAMERA_SCHEMA },
});

function axisCameraAnswers(state: ConfigurableState, error?: string, appliedVersion = 1n) {
  seedEntities([axisCameras, answeredWith(axisCamera, state, error, appliedVersion)]);
}

async function fillAxisWizard(canvas: Canvas) {
  await userEvent.type(canvas.getByLabelText("Frame rate"), "12");
  await userEvent.click(canvas.getByRole("button", { name: "Next" }));
  await userEvent.type(canvas.getByLabelText("Host"), "10.0.4.17");
  await userEvent.click(canvas.getByLabelText("Direct Drive"));
}

async function finishAxisWizard(canvas: Canvas, response = { accepted: true, debug: "" }) {
  await fillAxisWizard(canvas);
  mocked(worldClient.push).mockResolvedValueOnce(create(EntityChangeResponseSchema, response));
  await userEvent.click(canvas.getByRole("button", { name: "Finish" }));
  await userEvent.click((await shownAlertDialog("Confirm")).getByLabelText("Continue"));
}

async function waitsForAnswer(canvas: Canvas) {
  await expect(
    await within(canvas.getByLabelText("Finish")).findByRole("progressbar"),
  ).toBeVisible();
}

const POP = { type: "pop" };

const meta = {
  title: "Core/Aware/Command palette/Views/SetupView",
  component: SetupView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { entityId: AXIS_CAMERA, dispatch: fn() },
  beforeEach: () => seedEntities([axisCameras, axisCamera]),
  decorators: [
    (Story) => (
      <View className="native:flex-1 bg-card h-[560px] w-[760px]">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof SetupView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, step }) => {
    await step("the wizard opens on the first group's page", async () => {
      await expect(canvas.getByRole("heading", { name: "Frame rate*" })).toBeVisible();
      await expect(canvas.getByText("Step 1 of 2")).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
        "Close",
        "Delete",
        "Next",
      ]);
    });

    await step("Close leaves the wizard", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Close" }));
      await expect(args.dispatch).toHaveBeenCalledOnce();
      await expect(args.dispatch).toHaveBeenCalledWith(POP);
    });
  },
};

export const HoldsNextUntilValid: Story = {
  play: async ({ canvas, step }) => {
    const next = canvas.getByRole("button", { name: "Next" });

    await step("Next is held while the required frame rate is empty", async () => {
      await expect(next).toHaveAttribute("aria-disabled", "true");
    });

    await step("an out-of-range frame rate keeps Next held", async () => {
      await userEvent.type(canvas.getByLabelText("Frame rate"), "45");
      await expect(next).toHaveAttribute("aria-disabled", "true");
    });

    await step("a valid frame rate releases Next", async () => {
      await userEvent.clear(canvas.getByLabelText("Frame rate"));
      await userEvent.type(canvas.getByLabelText("Frame rate"), "12");
      await expect(next).not.toHaveAttribute("aria-disabled", "true");
    });
  },
};

export const BackKeepsValues: Story = {
  play: async ({ canvas, step }) => {
    await userEvent.type(canvas.getByLabelText("Frame rate"), "12");

    await step("Next opens the last page, which offers Back and Finish", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Next" }));
      await expect(canvas.getByText("Connection")).toBeVisible();
      await expect(canvas.getByText("Step 2 of 2")).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
        "Close",
        "Back",
        "Finish",
      ]);
    });

    await step("Back returns to the first page with the entered value", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Back" }));
      await expect(canvas.getByText("Step 1 of 2")).toBeVisible();
      await expect(canvas.getByLabelText("Frame rate")).toHaveValue("12");
    });
  },
};

export const ConfirmsDangerousField: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await fillAxisWizard(canvas);
    await userEvent.click(canvas.getByRole("button", { name: "Finish" }));
    await shownAlertDialog("Confirm");
    await expect(worldClient.push).not.toHaveBeenCalled();
  },
};

export const SaveRejected: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await finishAxisWizard(canvas, { accepted: false, debug: "host unreachable" });
    await expect(await screen.findByText("host unreachable")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Confirm" })).toBeNull());
    await expect(canvas.getByText("Step 2 of 2")).toBeVisible();
    await expect(args.dispatch).not.toHaveBeenCalled();
  },
};

export const Saves: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas, step }) => {
    await finishAxisWizard(canvas);

    await step("Finish saves the settings and waits for the camera to apply them", async () => {
      await waitsForAnswer(canvas);

      const saved = mocked(worldClient.push).mock.lastCall?.[0].changes?.[0];

      await expect(saved?.id).toBe(AXIS_CAMERA);
      await expect(saved?.config?.value).toEqual({
        fps: 12,
        host: "10.0.4.17",
        enable_direct_drive: true,
      });
      await expect(screen.queryByText(/configuration applied$/)).toBeNull();
      await expect(args.dispatch).not.toHaveBeenCalled();
    });

    await step("the wizard leaves once the camera applies them", async () => {
      axisCameraAnswers(ConfigurableState.ConfigurableStateActive);
      await expect(
        await screen.findByText("AXIS Camera 10.0.4.17 configuration applied"),
      ).toBeInTheDocument();
      await waitFor(() => expect(args.dispatch).toHaveBeenCalledWith(POP));
    });
  },
};

export const WaitsWhileCameraStarts: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: () => holdTimeouts(HANDSHAKE_TIMEOUT_MS),
  play: async ({ args, canvas, step }) => {
    await finishAxisWizard(canvas);
    await waitsForAnswer(canvas);

    await step("the wizard keeps waiting while the camera reports Starting", async () => {
      axisCameraAnswers(ConfigurableState.ConfigurableStateStarting, undefined, 0n);
      await waitsForAnswer(canvas);
      await expect(args.dispatch).not.toHaveBeenCalled();
    });

    await step("after 30 s a waiting line shows the camera's word", async () => {
      elapseHeldTimeouts();

      await expect(await canvas.findByText(wholeText(`${WAITING} (Starting)`))).toBeVisible();
      await expect(canvas.getByText("Step 2 of 2")).toBeVisible();
      await expect(toasts().queryByText("Starting")).toBeNull();
      await expect(canvas.getByLabelText("Finish")).not.toHaveAttribute("aria-disabled", "true");
      await expect(args.dispatch).not.toHaveBeenCalled();
    });

    await step("a failure hides the line and the backend error shows", async () => {
      axisCameraAnswers(ConfigurableState.ConfigurableStateFailed, "stream refused", 0n);

      await expect(await canvas.findByRole("alert")).toHaveProperty(
        "textContent",
        "stream refused",
      );
      await expect(canvas.queryByText(new RegExp(`^${WAITING}`))).toBeNull();
    });

    await step("the wizard leaves once the camera is active", async () => {
      axisCameraAnswers(ConfigurableState.ConfigurableStateActive);
      await expect(
        await screen.findByText("AXIS Camera 10.0.4.17 configuration applied"),
      ).toBeInTheDocument();
      await waitFor(() => expect(args.dispatch).toHaveBeenCalledWith(POP));
      await expect(canvas.queryByText(new RegExp(`^${WAITING}`))).toBeNull();
    });
  },
};

export const SettingsLeaveCameraInactive: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await finishAxisWizard(canvas);
    await waitsForAnswer(canvas);
    axisCameraAnswers(ConfigurableState.ConfigurableStateInactive);

    await expect(await toasts().findByText("Inactive")).toBeInTheDocument();
    await expect(canvas.getByText("Step 2 of 2")).toBeVisible();
    await expect(canvas.getByLabelText("Finish")).not.toHaveAttribute("aria-disabled", "true");
    await expect(args.dispatch).not.toHaveBeenCalled();
  },
};

export const SettingsRejected: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await finishAxisWizard(canvas);
    await waitsForAnswer(canvas);
    axisCameraAnswers(ConfigurableState.ConfigurableStateFailed, "stream refused");

    await expect(await toasts().findByText("Failed")).toBeInTheDocument();
    await expect(toasts().getByText("stream refused")).toBeInTheDocument();
    await expect(canvas.getByText("Step 2 of 2")).toBeVisible();
    await expect(canvas.getByLabelText("Finish")).not.toHaveAttribute("aria-disabled", "true");
    await expect(args.dispatch).not.toHaveBeenCalled();
  },
};

export const CameraReportsFailure: Story = {
  beforeEach: () =>
    seedEntities([
      axisCameras,
      entity(AXIS_CAMERA, {
        label: axisCamera.label,
        configurable: axisCamera.configurable,
        device: {
          parent: "axis.service",
          class: "camera",
          state: DeviceState.DeviceStateFailed,
          error: PROBE_ERROR,
        },
      }),
    ]),
  play: async ({ canvas, step }) => {
    await step("the full backend error sits under the header", async () => {
      await expect(canvas.getByRole("alert")).toHaveProperty("textContent", PROBE_ERROR);
      await expect(canvas.getByText("Step 1 of 2")).toBeVisible();
    });

    await step("the error leaves when the camera stops reporting it", async () => {
      seedEntities([axisCameras, axisCamera]);
      await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
    });
  },
};

export const WithoutSchema: Story = {
  beforeEach: () =>
    seedEntities([
      axisCameras,
      entity(AXIS_CAMERA, {
        device: axisCamera.device,
        configurable: { label: "AXIS Camera 10.0.4.17" },
      }),
    ]),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No schema available for this configuration")).toBeVisible();
  },
};

export const LongPage: Story = {
  beforeEach: () =>
    seedEntities([
      axisCameras,
      entity(AXIS_CAMERA, {
        device: axisCamera.device,
        configurable: { label: "AXIS Camera 10.0.4.17", schema: LONG_STREAM_SCHEMA },
      }),
    ]),
};

export const WaitsForNewCameraSettings: Story = {
  args: { entityId: ADDED_CAMERA },
  play: async ({ canvas, step }) => {
    await step("the wizard waits for settings without naming a kind it does not know", async () => {
      await expect(
        canvas.getByText("Waiting for the service to send the settings form"),
      ).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual(["Close"]);
    });

    await step("the camera arrives without a label and is named once by its id", async () => {
      seedEntities([axisCameras, axisCamera, entity(ADDED_CAMERA, { device: addedCamera.device })]);
      await expect(await canvas.findByText(ADDED_CAMERA)).toBeVisible();
      await expect(canvas.getAllByText(ADDED_CAMERA)).toHaveLength(1);
      await expect(
        canvas.getByText("Waiting for the service to send the settings form"),
      ).toBeVisible();
    });

    await step("a failing service shows its word and error while the wizard waits", async () => {
      seedEntities([
        axisService({
          configurable: {
            state: ConfigurableState.ConfigurableStateFailed,
            error: "license server unreachable",
          },
        }),
        axisCamera,
        entity(ADDED_CAMERA, { device: addedCamera.device }),
      ]);
      await expect(await canvas.findByText("license server unreachable")).toBeVisible();
      await expect(canvas.getByText("Failed")).toBeVisible();
    });

    await step("the wizard opens once the camera reports its settings", async () => {
      seedEntities([axisCameras, axisCamera, addedCamera]);
      await expect(await canvas.findByText("Step 1 of 1")).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
        "Close",
        "Delete",
        "Finish",
      ]);
    });
  },
};

export const CameraRemovedWhileOpen: Story = {
  args: { entityId: ADDED_CAMERA },
  beforeEach: () => seedEntities([axisCameras, axisCamera, addedCamera]),
  play: async ({ canvas, step }) => {
    await expect(canvas.getByText("Step 1 of 1")).toBeVisible();

    await step("the wizard says it is gone without naming a kind it does not know", async () => {
      seedEntities([axisCameras, axisCamera]);
      await expect(await canvas.findByText("No longer exists")).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual(["Close"]);
    });

    await step("the wizard returns when the camera does", async () => {
      seedEntities([axisCameras, axisCamera, addedCamera]);
      await expect(await canvas.findByText("Step 1 of 1")).toBeVisible();
    });
  },
};

export const DeletesCamera: Story = {
  args: { entityId: ADDED_CAMERA },
  beforeEach: () => seedEntities([axisCameras, axisCamera, addedCamera]),
  play: async ({ args, canvas }) => {
    mocked(worldClient.expireEntity).mockResolvedValueOnce(create(ExpireEntityResponseSchema));
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await userEvent.click((await shownAlertDialog("Delete device")).getByLabelText("Delete"));
    await expect(worldClient.expireEntity).toHaveBeenCalledWith({ id: ADDED_CAMERA });
    await waitFor(() => expect(args.dispatch).toHaveBeenCalledWith(POP));
    await expect(await screen.findByText("Deleted Camera")).toBeInTheDocument();
  },
};

export const ServiceActivation: Story = {
  args: { entityId: "wildlife.service" },
  beforeEach: () => seedEntities([axisCameras, wildlifeService]),
  play: async ({ canvas, step }) => {
    await step("a service opens a one-page wizard without Delete", async () => {
      await expect(canvas.getByText("Wildlife cameras")).toBeVisible();
      await expect(canvas.getByText("Step 1 of 1")).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual(["Close", "Finish"]);
    });

    await step("the wizard says when the service is removed", async () => {
      seedEntities([axisCameras]);
      await expect(await canvas.findByText("Service no longer exists")).toBeVisible();
    });
  },
};

export const AddsDeviceToServiceWithoutForm: Story = {
  args: { entityId: sensorServiceNotSetUp.id },
  beforeEach: () => {
    seedEntities([sensorServiceNotSetUp]);
    acceptPushes();
  },
  play: async ({ args, canvas, step }) => {
    await step("a service without a form offers its device class", async () => {
      await expect(canvas.getByText("Add device to Harbour buoys")).toBeVisible();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
        "Close",
        "Create Sensor",
      ]);
    });

    await step(
      "Create replaces the window with the new device's setup and marks it created",
      async () => {
        await userEvent.click(canvas.getByRole("button", { name: "Create Sensor" }));
        await waitFor(() => expect(args.dispatch).toHaveBeenCalledOnce());
        await expect(args.dispatch).toHaveBeenCalledWith({
          type: "replace",
          mode: {
            kind: "setup",
            entityId: expect.stringMatching(/^buoy\.service\.sensor\.[0-9a-f]{8}$/),
            created: true,
          },
        });
      },
    );
  },
};
