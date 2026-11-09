import { ControlButton } from "@hydris/ui/controls";
import { backdropClose } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, within } from "storybook/test";

import { DeviceModal } from "../../../storybook/device-modal";
import { coreProviders } from "../../../storybook/providers";
import { seed } from "../../../storybook/seed";
import { useMapStore } from "../store/map-store";
import { CoordinateEntryModal } from "./coordinate-entry-modal";

const mgrsFormat = () => seed(useMapStore, { coordEntryFormat: "mgrs" });

type CoordinateEntryModalPropsAndCustomArgs = ComponentProps<typeof CoordinateEntryModal> & {
  open: boolean;
};

const meta = {
  title: "Core/Aware/CoordinateEntryModal",
  component: CoordinateEntryModal,
  tags: ["!autodocs"],
  args: {
    open: true,
    initial: { latitude: 52.520008, longitude: 13.404954, altitude: 34.4 },
    onApply: fn(),
    onClose: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-[720px] w-full">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
  render: function Render({ open, ...args }) {
    const [, updateArgs] = useArgs<CoordinateEntryModalPropsAndCustomArgs>();

    if (!open) {
      return <ControlButton label="Enter coordinates" onPress={() => updateArgs({ open: true })} />;
    }

    const close = () => {
      args.onClose();
      updateArgs({ open: false });
    };

    return (
      <DeviceModal onClose={close}>
        <CoordinateEntryModal {...args} onClose={close} />
      </DeviceModal>
    );
  },
} satisfies Meta<CoordinateEntryModalPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("dialog", { name: "Enter coordinates" })).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Latitude" })).toHaveValue("52.520008");
    await expect(canvas.getByRole("textbox", { name: "Longitude" })).toHaveValue("13.404954");
    await expect(canvas.getByRole("textbox", { name: "Altitude in meters" })).toHaveValue("34");
  },
};

export const MgrsFormat: Story = {
  beforeEach: mgrsFormat,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "MGRS grid reference" })).toHaveValue(
      "33UUU9177620073",
    );
  },
};

export const WithoutAltitude: Story = {
  args: { initial: { latitude: -33.856784, longitude: 151.215297 } },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "Altitude in meters" })).toHaveValue("");

    await userEvent.click(canvas.getByLabelText("Apply coordinates"));
    await expect(args.onApply).toHaveBeenCalledOnce();
    await expect(args.onApply).toHaveBeenCalledWith({
      latitude: -33.856784,
      longitude: 151.215297,
      altitude: undefined,
    });
  },
};

export const Applies: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Apply coordinates"));
    await expect(args.onApply).toHaveBeenCalledOnce();
    await expect(args.onApply).toHaveBeenCalledWith({
      latitude: 52.520008,
      longitude: 13.404954,
      altitude: 34,
    });
  },
};

export const OutOfRangeLatitude: Story = {
  play: async ({ args, canvas }) => {
    const latitude = canvas.getByRole("textbox", { name: "Latitude" });
    const apply = canvas.getByLabelText("Apply coordinates");

    await userEvent.clear(latitude);
    await userEvent.type(latitude, "95");
    await expect(apply).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(apply);
    await expect(args.onApply).not.toHaveBeenCalled();
  },
};

export const InvalidAltitude: Story = {
  play: async ({ canvas }) => {
    const altitude = canvas.getByRole("textbox", { name: "Altitude in meters" });

    await userEvent.clear(altitude);
    await userEvent.type(altitude, "12m");
    await expect(canvas.getByLabelText("Apply coordinates")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const InvalidMgrs: Story = {
  beforeEach: mgrsFormat,
  play: async ({ args, canvas }) => {
    const mgrs = canvas.getByRole("textbox", { name: "MGRS grid reference" });
    const apply = canvas.getByLabelText("Apply coordinates");

    await userEvent.clear(mgrs);
    await userEvent.type(mgrs, "33UUU917762007");
    await expect(apply).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(apply);
    await expect(args.onApply).not.toHaveBeenCalled();
  },
};

export const SwitchesToMgrs: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("MGRS"));
    await expect(canvas.getByRole("textbox", { name: "MGRS grid reference" })).toHaveValue(
      "33UUU9177620073",
    );
  },
};

export const SwitchesBackToLatLong: Story = {
  beforeEach: mgrsFormat,
  play: async ({ canvas }) => {
    const mgrs = canvas.getByRole("textbox", { name: "MGRS grid reference" });

    await userEvent.clear(mgrs);
    await userEvent.type(mgrs, "31UDQ4825011951");
    await userEvent.click(canvas.getByText("Lat / Long"));
    await expect(canvas.getByRole("textbox", { name: "Latitude" })).toHaveValue("48.858369");
    await expect(canvas.getByRole("textbox", { name: "Longitude" })).toHaveValue("2.294480");
  },
};

export const AppliesOnEnter: Story = {
  play: async ({ args, canvas }) => {
    const longitude = canvas.getByRole("textbox", { name: "Longitude" });

    await userEvent.clear(longitude);
    await userEvent.type(longitude, "2.3522{Enter}");
    await expect(args.onApply).toHaveBeenCalledOnce();
    await expect(args.onApply).toHaveBeenCalledWith({
      latitude: 52.520008,
      longitude: 2.3522,
      altitude: 34,
    });
  },
};

export const PastedCoordinatesFillTheForm: Story = {
  beforeEach: mgrsFormat,
  play: async ({ args, canvas }) => {
    await userEvent.clear(canvas.getByRole("textbox", { name: "MGRS grid reference" }));
    await userEvent.paste("48.8566, 2.3522, 35");
    await expect(canvas.getByRole("textbox", { name: "Latitude" })).toHaveValue("48.8566");
    await expect(canvas.getByRole("textbox", { name: "Longitude" })).toHaveValue("2.3522");

    await userEvent.click(canvas.getByLabelText("Apply coordinates"));
    await expect(args.onApply).toHaveBeenCalledOnce();
    await expect(args.onApply).toHaveBeenCalledWith({
      latitude: 48.8566,
      longitude: 2.3522,
      altitude: 35,
    });
  },
};

export const PastedMgrsSwitchesMode: Story = {
  play: async ({ canvas }) => {
    await userEvent.clear(canvas.getByRole("textbox", { name: "Latitude" }));
    await userEvent.paste("31UDQ5248211717");
    await expect(canvas.getByRole("textbox", { name: "MGRS grid reference" })).toHaveValue(
      "31UDQ5248211717",
    );
  },
};

export const ClosesOnEscape: Story = {
  play: async ({ args, canvas }) => {
    await canvas.findByRole("dialog", { name: "Enter coordinates" });
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ClosesFromButton: Story = {
  play: async ({ args, canvas }) => {
    const dialog = within(canvas.getByRole("dialog", { name: "Enter coordinates" }));

    await userEvent.click(dialog.getByLabelText("Close"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ClosesFromBackdrop: Story = {
  play: async ({ args, canvas }) => {
    const dialog = canvas.getByRole("dialog", { name: "Enter coordinates" });

    await userEvent.click(backdropClose(canvas, dialog));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
