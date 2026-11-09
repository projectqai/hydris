import { ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { nvrService } from "../../../../../storybook/cameras";
import type { EntityInit } from "../../../../../storybook/entities";
import {
  camera,
  cameraClassification,
  configDevice,
  dockWebcam,
  entity,
  sensorClassification,
  webcams,
} from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { SourcesView } from "./sources-view";

const recorders = [
  nvrService,
  entity("nvr-1", {
    label: "Bay recorder 1",
    device: { parent: "nvr.service", category: "Cameras", state: DeviceState.DeviceStateActive },
  }),
  camera("nvr-1-channel-1", [], {
    label: "Bay channel 1",
    device: { parent: "nvr-1", class: "camera", state: DeviceState.DeviceStateActive },
    classification: cameraClassification(),
  }),
];

const relay = configDevice("relay.service", ConfigurableState.ConfigurableStateActive, {
  label: "Relay service",
});

function reportingService(
  name: string,
  label: string,
  classification: EntityInit["classification"],
) {
  return [
    configDevice(`${name}.service`, ConfigurableState.ConfigurableStateActive, { label }),
    entity(`${name}-1`, {
      label: `${name}-1`,
      device: { parent: `${name}.service`, state: DeviceState.DeviceStateActive },
      classification,
    }),
  ];
}

const reportingServices = [
  ...reportingService("gate", "Gate service", cameraClassification()),
  ...reportingService(
    "perimeter",
    "Perimeter service",
    sensorClassification({ kind: { case: "ew", value: {} } }),
  ),
  ...reportingService(
    "mast",
    "Mast service",
    sensorClassification({ kind: { case: "radar", value: {} } }),
  ),
  ...reportingService("field", "Field service", sensorClassification()),
];

const mastWithoutService = entity("mast-1", {
  label: "Zulu mast",
  device: {
    parent: "mast.service",
    state: DeviceState.DeviceStateFailed,
    error: "no reply from host",
  },
});

const runningCameras = [...webcams(), ...recorders];

const meta = {
  title: "Core/Aware/Command palette/Views/SourcesView",
  component: SourcesView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { dispatch: fn() },
  decorators: [paletteView()],
} satisfies Meta<typeof SourcesView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Add custom source")).toBeVisible();
    await expect(canvas.queryAllByRole("button")).toHaveLength(0);
  },
};

export const ReportedKinds: Story = {
  beforeEach: () => seedEntities(reportingServices, { isConnected: true }),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Ew/ }));
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "source-services", source: "ew" },
    });
  },
};

export const OtherServices: Story = {
  beforeEach: () => seedEntities([...runningCameras, relay], { isConnected: true }),
  play: async ({ args, canvas }) => {
    const tile = canvas.getByRole("button", { name: /^Other services/ });

    await expect(tile).toHaveTextContent(/^Other servicesActiveOther services$/);
    await userEvent.click(tile);
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "other-services" },
    });
  },
};

export const DevicesWithoutService: Story = {
  beforeEach: () =>
    seedEntities(
      [
        ...runningCameras,
        dockWebcam(ConfigurableState.ConfigurableStateFailed, "no frames"),
        mastWithoutService,
      ],
      { isConnected: true },
    ),
  play: async ({ args, canvas, step }) => {
    await step("the tile shows the failing device's state word, not its error", async () => {
      await expect(canvas.getByRole("button", { name: /^Without a service/ })).toHaveTextContent(
        /^Without a serviceFailedFailed$/,
      );
    });

    await step("arrows and Enter open the devices without a service", async () => {
      await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "devices-without-service" },
      });
    });
  },
};

export const HighlightStaysWhenATileLeaves: Story = {
  beforeEach: () =>
    seedEntities([...runningCameras, relay, mastWithoutService], { isConnected: true }),
  play: async ({ args, canvas }) => {
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");

    seedEntities([...runningCameras, mastWithoutService], { isConnected: true });
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: /^Other services/ })).toBeNull(),
    );
    await userEvent.keyboard("{Enter}");

    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "devices-without-service" },
    });
  },
};
