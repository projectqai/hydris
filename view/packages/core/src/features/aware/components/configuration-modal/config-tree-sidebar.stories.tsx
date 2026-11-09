import type { BadgeVariant } from "@hydris/ui/badge";
import { KeyboardProvider } from "@hydris/ui/keyboard";
import { wholeText } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Blocks, CloudSun, Radar } from "lucide-react-native";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import { entity } from "../../../../storybook/entities";
import { ConfigTreeSidebar } from "./config-tree-sidebar";
import type { CategoryGroup, ConfigSelection, DeviceNode } from "./use-config-tree";

type Props = ComponentProps<typeof ConfigTreeSidebar>;

function node(
  entityId: string,
  label: string,
  icon: DeviceNode["icon"],
  configState: { label: string; variant: BadgeVariant } | null,
  children: DeviceNode[] = [],
): DeviceNode {
  return {
    entityId,
    label,
    entity: entity(entityId, { label }),
    icon,
    children,
    isConfigurable: true,
    configState,
    canAddChildren: false,
  };
}

const tree: CategoryGroup[] = [
  {
    category: "Plugins",
    roots: [node("mqtt-1", "MQTT bridge", Blocks, { label: "Active", variant: "success" })],
  },
  {
    category: "Sensors",
    roots: [
      node("radar-hub", "Radar hub", Radar, { label: "Active", variant: "success" }, [
        node("radar-a", "Radar A", Radar, { label: "Failed", variant: "danger" }),
        node("radar-b", "Radar B", Radar, null),
      ]),
      node("weather-1", "Weather station", CloudSun, null),
    ],
  },
];

const radarA: ConfigSelection = { type: "device", entityId: "radar-a" };

const meta = {
  title: "Core/Aware/Configuration modal/ConfigTreeSidebar",
  component: ConfigTreeSidebar,
  argTypes: { tree: { control: false } },
  args: { tree, selection: null, query: "", onSelect: fn() },
  decorators: [
    (Story) => (
      <KeyboardProvider>
        <View className="native:flex-1 h-96 w-[300px]">
          <Story />
        </View>
      </KeyboardProvider>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<Props>();

    return (
      <ConfigTreeSidebar
        {...args}
        onSelect={(selection) => {
          args.onSelect(selection);
          updateArgs({ selection });
        }}
      />
    );
  },
} satisfies Meta<typeof ConfigTreeSidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Plugins")).toBeVisible();
    await expect(canvas.getByText("Sensors")).toBeVisible();
    await expect(canvas.queryByText("Radar hub")).toBeNull();
  },
};

export const SelectionRevealed: Story = {
  args: { selection: radarA },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Radar A")).toBeVisible();
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.queryByText("MQTT bridge")).toBeNull();
  },
};

export const CollapsesNode: Story = {
  args: { selection: radarA },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Radar A")).toBeVisible();

    await userEvent.click(canvas.getByLabelText("Collapse"));
    await expect(canvas.queryByText("Radar A")).toBeNull();
    await expect(canvas.getByLabelText("Expand")).toBeVisible();
  },
};

export const FocusCategory: Story = {
  args: { focusCategory: "Plugins" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("MQTT bridge")).toBeVisible();
    await expect(canvas.queryByText("Radar hub")).toBeNull();
  },
};

export const Searching: Story = {
  args: { query: "radar b" },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(wholeText("Radar B"))).toBeVisible();
    await expect(canvas.queryByText(wholeText("Radar A"))).toBeNull();
    await expect(canvas.queryByText(wholeText("Weather station"))).toBeNull();
  },
};

export const NoSearchResults: Story = {
  args: { query: "sonar" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No matching devices")).toBeVisible();
  },
};

export const Empty: Story = {
  args: { tree: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No devices connected")).toBeVisible();
  },
};

export const ExpandsAndSelects: Story = {
  args: { focusCategory: "Plugins" },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Sensors"));
    await userEvent.click(canvas.getByLabelText("Expand"));
    await expect(canvas.getByText("Radar B")).toBeVisible();

    await userEvent.click(canvas.getByText("MQTT bridge"));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith({ type: "device", entityId: "mqtt-1" });
  },
};

export const ExpandsWithArrowRight: Story = {
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await canvas.findByText("Sensors");
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    await expect(await canvas.findByText("Radar hub")).toBeVisible();

    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect(await canvas.findByText("Radar A")).toBeVisible();
  },
};

export const CollapsesWithArrowLeft: Story = {
  args: { selection: radarA },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Radar A")).toBeVisible();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect(canvas.queryByText("Radar A")).toBeNull();
    await expect(canvas.getByText("Radar hub")).toBeVisible();
  },
};

export const SelectsWithKeyboard: Story = {
  args: { focusCategory: "Plugins" },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await canvas.findByText("MQTT bridge");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await expect(await canvas.findByText("Weather station")).toBeVisible();

    await userEvent.keyboard("{ArrowUp}{Enter}");
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledWith({ type: "device", entityId: "mqtt-1" });
  },
};
