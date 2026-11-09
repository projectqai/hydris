import { ControlButton } from "@hydris/ui/controls";
import { backdropClose, pressable } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, within } from "storybook/test";

import { DeviceModal } from "../../../../storybook/device-modal";
import { SENSOR_WIDGETS } from "../../../sensors";
import { CAMERA_WIDGETS } from "../../camera-widgets";
import { WidgetPickerModal } from "./widget-picker-modal";

const EMBED_TAB = '[role="tab"] *';

const sensorsAndCameras = [...SENSOR_WIDGETS, ...CAMERA_WIDGETS];

const meta = {
  title: "Core/Aware/Layout/WidgetPickerModal",
  component: WidgetPickerModal,
  argTypes: {
    additionalWidgets: {
      control: "select",
      options: ["None", "Sensors and cameras"],
      mapping: { None: undefined, "Sensors and cameras": sensorsAndCameras },
    },
  },
  args: { visible: true, onClose: fn(), onSelect: fn() },
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-screen">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<ComponentProps<typeof WidgetPickerModal>>();

    if (!args.visible) {
      return <ControlButton label="Choose widget" onPress={() => updateArgs({ visible: true })} />;
    }

    const close = () => {
      args.onClose();
      updateArgs({ visible: false });
    };

    return (
      <DeviceModal onClose={close}>
        <WidgetPickerModal {...args} onClose={close} />
      </DeviceModal>
    );
  },
} satisfies Meta<typeof WidgetPickerModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("dialog", { name: "Widget picker" })).toBeVisible();
    await expect(canvas.getByText("Live entity map")).toBeVisible();
    await expect(canvas.getByRole("tab", { selected: true })).toHaveAccessibleName("Layout");
  },
};

export const CurrentWidget: Story = {
  args: { currentContent: { type: "component", componentId: "chat" } },
  play: async ({ canvas }) => {
    await expect(pressable(canvas.getByText("Chat"))).toHaveAttribute("aria-current", "true");
    await expect(pressable(canvas.getByText("Map"))).toHaveAttribute("aria-current", "false");
  },
};

export const MonitoringTab: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Monitoring" }));
    await expect(canvas.getByText("Heart rate, SpO₂, temperature")).toBeVisible();
    await expect(canvas.getByRole("tab", { selected: true })).toHaveAccessibleName("Monitoring");
    await expect(canvas.queryByText("Live entity map")).toBeNull();
  },
};

export const SelectsWidget: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Map"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith({
      type: "component",
      componentId: "mapPane",
    });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const AdditionalWidgets: Story = {
  args: { additionalWidgets: sensorsAndCameras },
  play: async ({ args, canvas }) => {
    const tabs = canvas.getAllByRole("tab").map((tab) => tab.textContent);

    await expect(tabs).toEqual(["Layout", "Monitoring", "Sensors", "Cameras", "Embed"]);

    await userEvent.click(canvas.getByRole("tab", { name: "Sensors" }));
    await userEvent.click(canvas.getByText("Levels"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith({
      type: "sensor",
      widgetId: "sensor:levels",
    });
  },
};

export const EmbedTab: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Embed" }));

    const button = pressable(canvas.getByText("Embed", { ignore: EMBED_TAB }));

    await expect(button).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup({ pointerEventsCheck: 0 }).click(button);
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const FocusesUrlFromLabel: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Embed" }));

    const field = canvas.getByRole("textbox", { name: "Embed URL" });

    await expect(field).not.toHaveFocus();

    await userEvent.click(canvas.getByText("URL"));
    await expect(field).toHaveFocus();
  },
};

export const EmbedsUrl: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Embed" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Embed URL" }), "example.com");
    await userEvent.click(pressable(canvas.getByText("Embed", { ignore: EMBED_TAB })));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith({
      type: "iframe",
      url: "https://example.com",
    });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const EmbedsOnEnter: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Embed" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Embed URL" }),
      "http://intranet.local/feed{Enter}",
    );
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith({
      type: "iframe",
      url: "http://intranet.local/feed",
    });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ClosesFromButton: Story = {
  play: async ({ args, canvas }) => {
    const dialog = within(canvas.getByRole("dialog", { name: "Widget picker" }));

    await expect(canvas.getAllByLabelText("Close")).toHaveLength(2);
    await userEvent.click(dialog.getByLabelText("Close"));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ClosesFromBackdrop: Story = {
  play: async ({ args, canvas }) => {
    const dialog = canvas.getByRole("dialog", { name: "Widget picker" });

    await expect(canvas.getAllByLabelText("Close")).toHaveLength(2);
    await userEvent.click(backdropClose(canvas, dialog));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
