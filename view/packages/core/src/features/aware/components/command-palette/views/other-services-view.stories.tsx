import { ConfigurableState, DeviceState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent } from "storybook/test";

import { configDevice, entity, webcams } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { OtherServicesView } from "./other-services-view";

const services = [
  configDevice("tracker.service", ConfigurableState.ConfigurableStateFailed, {
    label: "Track fusion",
    device: { state: DeviceState.DeviceStateActive, category: "Fusion" },
    configurable: {
      label: "Track fusion",
      state: ConfigurableState.ConfigurableStateFailed,
      error: "no track source",
    },
  }),
  configDevice("radar.service", ConfigurableState.ConfigurableStateActive, {
    label: "Radar service",
    configurable: { label: "Radar service", state: ConfigurableState.ConfigurableStateActive },
  }),
  configDevice("timesync.service", ConfigurableState.ConfigurableStateActive, {
    label: "Time sync",
    device: { state: DeviceState.DeviceStateActive },
    configurable: { label: "Time sync", state: ConfigurableState.ConfigurableStateActive },
  }),
  ...webcams(),
  entity("discovery.service", {
    label: "Network discovery",
    device: { state: DeviceState.DeviceStateActive },
  }),
];

const meta = {
  title: "Core/Aware/Command palette/Views/OtherServicesView",
  component: OtherServicesView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { dispatch: fn() },
  beforeEach: () => seedEntities(services, { isConnected: true }),
  decorators: [paletteView()],
} satisfies Meta<typeof OtherServicesView>;

export default meta;

type Story = StoryObj<typeof meta>;

function headingsAndTiles(canvas: { getAllByRole: (role: string) => HTMLElement[] }) {
  return [...canvas.getAllByRole("heading"), ...canvas.getAllByRole("button")].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

export const Default: Story = {
  play: async ({ args, canvas, step }) => {
    await step("a service without a category sits under Miscellaneous, last", async () => {
      const items = headingsAndTiles(canvas);

      await expect(items).toHaveLength(6);
      await expect(items[4]).toHaveTextContent(/^Miscellaneous$/);
      await expect(items[5]).toHaveAccessibleName(/^Time sync/);
    });

    await step("each category heads its services, categories in alphabetical order", async () => {
      const items = headingsAndTiles(canvas);

      await expect(items[0]).toHaveTextContent(/^Fusion$/);
      await expect(items[1]).toHaveAccessibleName(/^Track fusion/);
      await expect(items[2]).toHaveTextContent(/^Sensors$/);
      await expect(items[3]).toHaveAccessibleName(/^Radar service/);
    });

    await step("a tile opens the service's settings", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Track fusion/ }));
      await expect(args.dispatch).toHaveBeenCalledWith({
        type: "push",
        mode: { kind: "config", entityId: "tracker.service" },
      });
    });
  },
};

export const ArrowDownMovesToTheNextCategory: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    await expect(args.dispatch).toHaveBeenCalledWith({
      type: "push",
      mode: { kind: "config", entityId: "radar.service" },
    });
  },
};

export const NoOtherServices: Story = {
  beforeEach: () => seedEntities([], { isConnected: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No other services")).toBeVisible();
    await expect(
      canvas.getByText("Services without cameras or sensors appear here once set up or reporting"),
    ).toBeVisible();
  },
};
