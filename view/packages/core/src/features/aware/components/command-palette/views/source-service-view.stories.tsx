import { accessibleName } from "@hydris/ui/storybook/queries";
import { ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, mocked, screen, userEvent, waitFor, within } from "storybook/test";

import { worldClient } from "../../../../../lib/api/world-client";
import {
  axisService,
  cameraAwaitingSetup,
  DOCK_ERROR,
  dockCamera,
  gateCamera,
  SERVICE_SCHEMA,
  simcamService,
  wildlifeService,
} from "../../../../../storybook/cameras";
import { localClock, STORY_NOW } from "../../../../../storybook/clock";
import { withSchema } from "../../../../../storybook/config";
import {
  camera,
  CAMERA_CLASSES,
  cameraService,
  entity,
  notSetUpCameraService,
  setUpCamera,
  webcams,
  webrtc,
} from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { coreProviders } from "../../../../../storybook/providers";
import { acceptPushes } from "../../../../../storybook/requests";
import { seedEntities } from "../../../../../storybook/seed";
import {
  RIVER_GAUGES_ID,
  riverGauges,
  sensor,
  sensorAwaitingSetup,
  sensorService,
  WEATHER_ID,
  weatherService,
} from "../../../../../storybook/sensors";
import { SourceServiceView } from "./source-service-view";

const LICENSE_ERROR = "license expired for 4 channels";

const STATE_TEXT =
  /^(Active|Scheduled|Starting|Inactive|Pending|Degraded|Failed|Conflict|Unknown)$/;

const cameraDebugger = [
  simcamService,
  gateCamera,
  dockCamera(ConfigurableState.ConfigurableStateFailed, DOCK_ERROR),
  entity("simcam-recorder", {
    label: "Yard recorder",
    device: { parent: "simcam.service", category: "Cameras" },
  }),
  camera("simcam-recorder-1", [], {
    label: "Yard channel",
    device: { parent: "simcam-recorder", category: "Cameras" },
  }),
];

const axisCameras = [
  axisService({ interactivity: { icon: "camera" } }),
  cameraAwaitingSetup(SERVICE_SCHEMA),
];

const all = [...cameraDebugger, ...axisCameras, ...webcams(), wildlifeService];

function opensSetup(entityId: string) {
  return { type: "push", mode: { kind: "setup", entityId } };
}

const meta = {
  title: "Core/Aware/Command palette/Views/SourceServiceView",
  component: SourceServiceView,
  tags: ["!autodocs"],
  argTypes: {
    source: { control: "radio", options: ["electroOptical", "sensor"] },
    tab: { control: "radio", options: ["overview", "metrics", "status"] },
    dispatch: { control: false },
  },
  args: {
    source: "electroOptical",
    providerId: "simcam.service",
    onTabChange: fn(),
    dispatch: fn(),
  },
  beforeEach: () => seedEntities(all, { isConnected: true }),
  decorators: [paletteView({ keyboard: false }), coreProviders()],
} satisfies Meta<typeof SourceServiceView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, step }) => {
    await step("the header names the service by label and id", async () => {
      await expect(canvas.getAllByText(/^(Camera Debugger|simcam\.service)$/)).toHaveLength(2);
      await expect(canvas.getByText("simcam.service")).toBeVisible();
    });

    await step("a running camera reads its own state under its failing service", async () => {
      await expect(canvas.getByText("Active")).toBeVisible();
    });

    await step("the service's status is asked for when pressed", async () => {
      await userEvent.click(canvas.getByTestId("tab-status"));
      await expect(args.onTabChange).toHaveBeenCalledWith("status");
    });

    await step("a set-up camera opens its page", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Gate camera/ }));
      await expect(args.dispatch).toHaveBeenCalledOnce();
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "camera", entityId: "simcam-1" },
      });
    });

    await step("a device that is no camera opens its device page", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Yard recorder/ }));
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: {
          kind: "device",
          source: "electroOptical",
          entityId: "simcam-recorder",
        },
      });
    });
  },
};

export const CameraWithoutStreams: Story = {
  beforeEach: () =>
    seedEntities(
      [
        simcamService,
        {
          ...setUpCamera(
            "simcam-3",
            "Mast camera",
            "simcam.service",
            ConfigurableState.ConfigurableStateActive,
          ),
          camera: undefined,
        },
      ],
      { isConnected: true },
    ),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Mast camera/ }));
    await expect(args.dispatch).toHaveBeenLastCalledWith({
      type: "push",
      mode: { kind: "device", source: "electroOptical", entityId: "simcam-3" },
    });
  },
};

export const ServiceShowsItsOwnError: Story = {
  args: { providerId: "axis.service" },
  beforeEach: () =>
    seedEntities(
      [
        axisService({
          configurable: {
            supportedDeviceClasses: CAMERA_CLASSES,
            state: ConfigurableState.ConfigurableStateFailed,
            error: LICENSE_ERROR,
          },
        }),
        setUpCamera(
          "axis-1",
          "Pier camera",
          "axis.service",
          ConfigurableState.ConfigurableStateConflict,
          "stream profile taken by another client",
        ),
      ],
      { isConnected: true },
    ),
  play: async ({ canvas, step }) => {
    await step("the header sums the service and its cameras", async () => {
      const camera = canvas.getByRole("button", { name: /^Pier camera/ });
      const header = canvas.getAllByText("Conflict").filter((el) => !camera.contains(el));

      await expect(header).toHaveLength(1);
    });

    await step("the error names the service's own state", async () => {
      await expect(canvas.getByRole("alert")).toHaveTextContent(
        /^Failed: license expired for 4 channels$/,
      );
    });
  },
};

export const OpensCameraWithKeyboard: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "camera", entityId: "simcam-2" },
    });
  },
};

export const CameraNeedingSetup: Story = {
  args: { providerId: "axis.service" },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^AXIS Camera 10\.0\.4\.17/ }));
    await expect(args.dispatch).toHaveBeenCalledWith(opensSetup("axis.device.10_0_4_17"));
  },
};

export const SettingsOpensServiceSettings: Story = {
  args: { providerId: "axis.service" },
  beforeEach: () =>
    seedEntities([withSchema(axisService(), SERVICE_SCHEMA)], { isConnected: true }),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Config" }));
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "settings", entityId: "axis.service" },
    });
  },
};

export const AddsCamera: Story = {
  args: { providerId: "axis.service" },
  play: async ({ args }) => {
    acceptPushes();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");

    await waitFor(() => expect(args.dispatch).toHaveBeenCalledOnce());

    const created = mocked(worldClient.push).mock.lastCall?.[0].changes?.[0];

    await expect(created?.device).toMatchObject({ parent: "axis.service", class: "camera" });
    await expect(created?.id).toMatch(/^axis\.service\.camera\.[0-9a-f]{8}$/);
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "setup", entityId: created?.id, created: true },
    });
  },
};

export const AddCameraFails: Story = {
  args: { providerId: "axis.service" },
  play: async ({ args, canvas }) => {
    const addButtons = canvas.getAllByRole("button", { name: "Add Camera" });

    await expect(addButtons).toHaveLength(2);
    await userEvent.click(addButtons[0]!);
    await expect(
      await screen.findByText("worldClient.push called from a story"),
    ).toBeInTheDocument();
    await expect(args.dispatch).not.toHaveBeenCalled();
  },
};

export const SeveralClassesOpenThePicker: Story = {
  args: { providerId: "relay.service" },
  beforeEach: () =>
    seedEntities(
      [
        cameraService("relay.service", "Relay cameras", {
          configurable: {
            supportedDeviceClasses: [
              { class: "relay", label: "Relay" },
              { class: "antenna", label: "Antenna" },
            ],
            state: ConfigurableState.ConfigurableStateActive,
          },
        }),
      ],
      { isConnected: true },
    ),
  play: async ({ args, canvas, step }) => {
    await step("each declared class has its own tile", async () => {
      await expect(canvas.getByRole("button", { name: "Add Relay" })).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Add Antenna" })).toBeVisible();
    });

    await step("the header asks which class to add", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Add device" }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "config", entityId: "relay.service", adding: true },
      });
    });
  },
};

export const ServiceStaysWhenItsLastCameraLeaves: Story = {
  args: { providerId: "webcam.service" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Desk webcam/ })).toBeVisible();

    seedEntities(
      all.filter((e) => e.id !== "webcam-1"),
      { isConnected: true },
    );
    await expect(await canvas.findByText("No Electro Optical devices")).toBeVisible();
    await expect(canvas.getByText("webcam.service")).toBeVisible();
  },
};

export const ServiceDisappearsWhileOpen: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("simcam.service")).toBeVisible();

    seedEntities(
      all.filter((e) => !e.id.startsWith("simcam")),
      { isConnected: true },
    );
    await expect(await canvas.findByText("Service no longer exists")).toBeVisible();
    await expect(canvas.queryByText("simcam.service")).toBeNull();
    await expect(canvas.queryByText("No Electro Optical devices")).toBeNull();
  },
};

export const ServiceNeverSetUp: Story = {
  args: { providerId: "wildlife.service" },
  play: async ({ args, canvas, step }) => {
    await step("the page offers Activate and shows no state", async () => {
      await expect(canvas.getByText("wildlife.service")).toBeVisible();
      await expect(canvas.queryByText(STATE_TEXT)).toBeNull();
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
        "Config",
        "Activate Wildlife cameras",
      ]);
    });

    await step("Activate opens the service's setup", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Activate Wildlife cameras" }));
      await expect(args.dispatch).toHaveBeenCalledWith(opensSetup("wildlife.service"));
    });

    await step("arrows and Enter open the setup too", async () => {
      await userEvent.keyboard("{ArrowDown}{Enter}");
      await expect(args.dispatch).toHaveBeenCalledTimes(2);
      await expect(args.dispatch).toHaveBeenLastCalledWith(opensSetup("wildlife.service"));
    });
  },
};

export const Sensors: Story = {
  args: { source: "sensor", providerId: WEATHER_ID },
  beforeEach: () =>
    seedEntities(
      [
        weatherService,
        sensor("weather.wind", "Wind vane"),
        sensor("weather.rain", "Rain gauge", DeviceState.DeviceStateFailed),
        camera("weather.cam", [webrtc("Main", "/whep/weather-cam")], {
          label: "Mast camera",
          device: { parent: WEATHER_ID, class: "camera", state: DeviceState.DeviceStateActive },
        }),
        sensorAwaitingSetup,
      ],
      { isConnected: true },
    ),
  play: async ({ args, canvas, step }) => {
    await step("devices in label order, then the class the service declares", async () => {
      await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
        "Add Sensor",
        expect.stringMatching(/^Mast camera/),
        expect.stringMatching(/^Mast sensor 3/),
        expect.stringMatching(/^Rain gauge/),
        expect.stringMatching(/^Wind vane/),
        "Add Sensor",
      ]);
    });

    await step("a failing sensor reads its own state", async () => {
      const rain = canvas.getByRole("button", { name: /^Rain gauge/ });

      await expect(rain).toHaveTextContent(/Failed/);
    });

    await step("a set-up sensor opens its device page", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Wind vane/ }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: {
          kind: "device",
          source: "sensor",
          entityId: "weather.wind",
        },
      });
    });

    await step("a sensor waiting for setup opens its setup", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Mast sensor 3/ }));
      await expect(args.dispatch).toHaveBeenLastCalledWith(opensSetup("weather.device.mast-3"));
    });

    await step("a device with streams shows its stream and opens its camera page", async () => {
      const mast = canvas.getByRole("button", { name: /^Mast camera/ });

      await expect(await within(mast).findByText("Connecting…")).toBeVisible();
      await userEvent.click(mast);
      await expect(args.dispatch).toHaveBeenLastCalledWith({
        type: "push",
        mode: { kind: "camera", entityId: "weather.cam" },
      });
    });
  },
};

export const RiverGauges: Story = {
  args: { source: "sensor", providerId: RIVER_GAUGES_ID },
  beforeEach: () =>
    seedEntities(riverGauges({ "gauge-03": { pump: DeviceState.DeviceStateFailed } }), {
      isConnected: true,
    }),
  play: async ({ args, canvas, step }) => {
    await step("each direct child of the service shows once, in label order", async () => {
      const names = canvas.getAllByRole("button").map(accessibleName);

      await expect(names).toHaveLength(8);
      await expect(names.at(-1)).toBe("Add Sensor");
      await expect(names.slice(0, 4)).toEqual([
        "Add Sensor",
        expect.stringMatching(/^gauge-01/),
        expect.stringMatching(/^gauge-02/),
        expect.stringMatching(/^gauge-03/),
      ]);
    });

    await step("a gauge shows its state word, then its battery and link as sent", async () => {
      await expect(canvas.getByRole("button", { name: /^gauge-01 / })).toHaveTextContent(
        new RegExp(
          `^gauge-01InactiveBattery92%StatusConnectedLast seen${localClock(STORY_NOW - 137_000)}$`,
        ),
      );
    });

    await step("a gauge reads the failure of its pump", async () => {
      await expect(canvas.getByRole("button", { name: /^gauge-03 / })).toHaveTextContent(/Failed/);
      await expect(canvas.getByRole("button", { name: /^gauge-02 / })).toHaveTextContent(
        /Inactive/,
      );
    });

    await step("a gauge waiting for setup opens its setup", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^gauge-01 Inactive/ }));
      await expect(args.dispatch).toHaveBeenLastCalledWith(opensSetup("gauge-01"));
    });
  },
};

export const RiverGaugesNeverSetUp: Story = {
  args: { source: "sensor", providerId: RIVER_GAUGES_ID },
  beforeEach: () =>
    seedEntities(
      [
        sensorService(RIVER_GAUGES_ID, "River gauges", { config: undefined }),
        ...riverGauges({ "gauge-03": { pump: DeviceState.DeviceStateFailed } }).filter(
          (e) => e.id !== RIVER_GAUGES_ID,
        ),
      ],
      { isConnected: true },
    ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
      expect.stringMatching(/^gauge-03Failed/),
      "Activate River gauges",
    ]);
  },
};

export const ServiceActivated: Story = {
  args: { providerId: "wildlife.service" },
  beforeEach: () =>
    seedEntities(
      [
        notSetUpCameraService("wildlife.service", "Wildlife cameras", {
          configurable: {
            supportedDeviceClasses: CAMERA_CLASSES,
            schema: SERVICE_SCHEMA,
            state: ConfigurableState.ConfigurableStateActive,
          },
          config: { value: { username: "ranger" }, version: 1n },
        }),
      ],
      { isConnected: true },
    ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Active")).toBeVisible();
    await expect(canvas.getAllByRole("button").map(accessibleName)).toEqual([
      "Add Camera",
      "Config",
      "Add Camera",
    ]);
  },
};
