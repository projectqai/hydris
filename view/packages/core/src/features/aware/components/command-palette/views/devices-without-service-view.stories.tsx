import { DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { entity } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { DevicesWithoutServiceView } from "./devices-without-service-view";

const MAST_ERROR = "no reply from host after three retries on the backup link";

const devicesWithoutService = [
  entity("sensor-1", {
    label: "Sensor Bravo",
    device: { parent: "sensor.service", class: "sensor", state: DeviceState.DeviceStateActive },
  }),
  entity("sensor-2", {
    label: "Sensor Alpha",
    device: { parent: "sensor.service", class: "sensor" },
  }),
  entity("sensor-1.heater", {
    label: "Sensor Bravo heater",
    device: { parent: "sensor-1", state: DeviceState.DeviceStateActive },
  }),
  entity("mast-1", {
    label: "Zulu mast",
    device: { parent: "mast.service", state: DeviceState.DeviceStateFailed, error: MAST_ERROR },
  }),
];

const meta = {
  title: "Core/Aware/Command palette/Views/DevicesWithoutServiceView",
  component: DevicesWithoutServiceView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { dispatch: fn() },
  beforeEach: () => seedEntities(devicesWithoutService, { isConnected: true }),
  decorators: [paletteView()],
} satisfies Meta<typeof DevicesWithoutServiceView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas, step }) => {
    await step("devices sit under the id of their missing service, by id then label", async () => {
      await expect(canvas.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
        "mast.service",
        "sensor.service",
      ]);
      await expect(canvas.getAllByText(/^Sensor (Alpha|Bravo)/).map((e) => e.textContent)).toEqual([
        "Sensor Alpha",
        "Sensor Alpha",
        "Sensor Bravo",
        "Sensor Bravo",
        "Sensor Bravo heater",
        "Sensor Bravo heater",
      ]);
    });

    await step("a failing device shows its state word, not its error", async () => {
      await expect(canvas.getByRole("button", { name: /^Zulu mast/ })).toHaveTextContent(
        /^Zulu mastFailedFailed$/,
      );
      await expect(canvas.queryByRole("alert")).toBeNull();
    });

    await step("a card shows the arrow and opens the device's page", async () => {
      for (const card of canvas.getAllByRole("button")) {
        await expect(card.querySelectorAll("svg")).toHaveLength(2);
      }

      await userEvent.click(canvas.getByRole("button", { name: /^Zulu mast/ }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "device", entityId: "mast-1" },
      });
    });
  },
};

export const ArrowDownMovesToTheCardBelow: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ args }) => {
    await userEvent.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "device", entityId: "sensor-2" },
    });
  },
};

export const EveryDeviceHasAService: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Zulu mast")).toBeVisible();

    seedEntities([], { isConnected: true });
    await expect(await canvas.findByText("No devices without a service")).toBeVisible();
    await expect(canvas.getByText("Devices whose service is missing appear here")).toBeVisible();
  },
};
