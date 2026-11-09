import { ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { axisService, nvrService, simcamService } from "../../../../../storybook/cameras";
import {
  camera,
  cameraClassification,
  configDevice,
  entity,
  sensorClassification,
  webcams,
} from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { sensor, WEATHER_ID, weatherService } from "../../../../../storybook/sensors";
import type { SourceKind } from "../../../../mission/sources";
import { SourceServicesView } from "./source-services-view";

const cameraServices = [
  ...webcams(),
  simcamService,
  axisService(),
  nvrService,
  camera("nvr-1-channel-1", [], {
    label: "Bay channel 1",
    device: { parent: "nvr.service", class: "camera", state: DeviceState.DeviceStateActive },
    classification: cameraClassification(),
  }),
  configDevice("relay.service", ConfigurableState.ConfigurableStateActive, {
    label: "Relay service",
  }),
  entity("discovery.service", {
    label: "Network discovery",
    device: { category: "Cameras", state: DeviceState.DeviceStateActive },
  }),
];

function providerMode(providerId: string, source: SourceKind = "electroOptical") {
  return { type: "push", mode: { kind: "source-service", source, providerId } };
}

const meta = {
  title: "Core/Aware/Command palette/Views/SourceServicesView",
  component: SourceServicesView,
  tags: ["!autodocs"],
  argTypes: {
    source: { control: "radio", options: ["electroOptical", "sensor"] },
    dispatch: { control: false },
  },
  args: { source: "electroOptical", dispatch: fn() },
  beforeEach: () => seedEntities(cameraServices, { isConnected: true }),
  decorators: [paletteView()],
} satisfies Meta<typeof SourceServicesView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^nvr/ }));
    await expect(args.dispatch).toHaveBeenCalledOnce();
    await expect(args.dispatch).toHaveBeenCalledWith(providerMode("nvr.service"));
  },
};

export const OpensServiceWithKeyboard: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}{Enter}");
    await expect(args.dispatch).toHaveBeenCalledWith(providerMode("webcam.service"));
  },
};

const sensorServices = [...cameraServices, weatherService, sensor("weather.wind", "Wind vane")];

export const SensorsWithoutAKind: Story = {
  args: { source: "sensor" },
  beforeEach: () => seedEntities(sensorServices, { isConnected: true }),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Weather station/ }));
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "setup", entityId: "weather.service" },
    });
  },
};

export const OpensServiceOnceDeviceSetUp: Story = {
  args: { source: "sensor" },
  beforeEach: () =>
    seedEntities(
      [
        weatherService,
        entity("weather.wind", {
          label: "Wind vane",
          device: { parent: WEATHER_ID, class: "sensor", state: DeviceState.DeviceStateActive },
          classification: sensorClassification(),
          config: {},
        }),
      ],
      { isConnected: true },
    ),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Weather station/ }));
    await expect(args.dispatch).toHaveBeenCalledWith(providerMode(WEATHER_ID, "sensor"));
  },
};

const customPlugins = entity("plugins.custom", {
  label: "Custom Plugins",
  device: { category: "Plugins", state: DeviceState.DeviceStateActive },
  configurable: { supportedDeviceClasses: [{ class: "plugin", label: "Custom Plugin" }] },
});

export const NoServiceOfTheKind: Story = {
  args: { source: "radar" },
  play: async ({ args, canvas, step }) => {
    await step("without a plugin service, the screen offers no plugin link", async () => {
      await expect(canvas.getByText("Connect Radar sources.")).toBeVisible();
      await expect(canvas.queryByRole("link")).toBeNull();
    });

    await step("the link opens the plugin service ready to add a plugin", async () => {
      seedEntities([...cameraServices, customPlugins], { isConnected: true });
      await userEvent.click(await canvas.findByRole("link", { name: "add a plugin" }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "config", entityId: "plugins.custom", adding: true },
      });
    });
  },
};
