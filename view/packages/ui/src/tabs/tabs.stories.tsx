import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Layers, Map, Radio } from "lucide-react-native";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { Tab, Tabs } from "./tabs";

function Panel({ children }: { children: string }) {
  return <Text className="text-13 text-foreground flex-1 p-3 font-sans">{children}</Text>;
}

const meta = {
  title: "UI/Navigation and menus/Tabs",
  component: Tabs,
  subcomponents: { Tab },
  args: { fill: false, onTabChange: fn() },
  argTypes: { children: { control: false } },
  decorators: [
    (Story) => (
      <View className="w-96">
        <Story />
      </View>
    ),
  ],
  render: (args) => (
    <Tabs {...args}>
      <Tab name="overview" title="Overview">
        <Panel>Overview content</Panel>
      </Tab>
      <Tab name="details" title="Details">
        <Panel>Details content</Panel>
      </Tab>
      <Tab name="history" title="History">
        <Panel>History content</Panel>
      </Tab>
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof Tabs>;

export const Default: Story = {};

export const IconTabsWithSubtitle: Story = {
  args: { initialTab: "layers" },
  render: (args) => (
    <Tabs {...args}>
      <Tab name="map" title="Map" icon={Map}>
        <Panel>Map content</Panel>
      </Tab>
      <Tab name="layers" title="Layers" icon={Layers}>
        <Panel>Layers content</Panel>
      </Tab>
      <Tab name="comms" title="Comms" subtitle="Radio" icon={Radio}>
        <Panel>Comms content</Panel>
      </Tab>
    </Tabs>
  ),
};

export const ManyTabsInNarrowContainer: Story = {
  decorators: [
    (Story) => (
      <View className="w-64">
        <Story />
      </View>
    ),
  ],
  render: (args) => (
    <Tabs {...args}>
      {["Overview", "Details", "History", "Sensors", "Comms", "Notes"].map((title) => (
        <Tab key={title} name={title.toLowerCase()} title={title}>
          <Panel>{`${title} content`}</Panel>
        </Tab>
      ))}
    </Tabs>
  ),
};

export const ScrollsToPressedTab: Story = {
  decorators: [
    (Story) => (
      <View role="region" aria-label="Tab strip" className="w-64">
        <Story />
      </View>
    ),
  ],
  render: ManyTabsInNarrowContainer.render,
  play: async ({ canvas }) => {
    const strip = canvas.getByRole("region", { name: "Tab strip" }).getBoundingClientRect();
    const sensors = canvas.getByText("Sensors");

    await expect(sensors.getBoundingClientRect().right).toBeGreaterThan(strip.right);

    await userEvent.click(sensors);
    await waitFor(() =>
      expect(sensors.getBoundingClientRect().left - strip.left).toBeLessThan(strip.width / 2),
    );
  },
};

export const Fill: Story = {
  args: { fill: true },
  decorators: [
    (Story) => (
      <View className="h-48">
        <Story />
      </View>
    ),
  ],
};

export const Hovered: Story = { globals: { pseudo: { hover: true } } };

export const HoverDisabled: Story = {
  args: { disableHover: true },
  globals: { pseudo: { hover: true } },
};

export const SwitchesTab: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Overview content")).toBeVisible();

    await userEvent.click(canvas.getByText("Details"));
    await expect(await canvas.findByText("Details content")).toBeVisible();
    await waitFor(() => expect(canvas.queryByText("Overview content")).toBeNull());
    await expect(args.onTabChange).toHaveBeenCalledWith("details");
  },
};

export const SwitchesTabWithEnter: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByText("Details content")).toBeVisible();
    await expect(args.onTabChange).toHaveBeenCalledOnce();
    await expect(args.onTabChange).toHaveBeenCalledWith("details");
  },
};

export const Controlled: Story = {
  args: { currentTab: "history" },
  render: function Render(args) {
    const [, updateArgs] = useArgs<ComponentProps<typeof Tabs>>();

    return (
      <Tabs
        {...args}
        onTabChange={(currentTab) => {
          args.onTabChange?.(currentTab);
          updateArgs({ currentTab });
        }}
      >
        <Tab name="overview" title="Overview">
          <Panel>Overview content</Panel>
        </Tab>
        <Tab name="details" title="Details">
          <Panel>Details content</Panel>
        </Tab>
        <Tab name="history" title="History">
          <Panel>History content</Panel>
        </Tab>
      </Tabs>
    );
  },
  play: async ({ args, canvas }) => {
    const shown = args.currentTab === "details" ? "Details" : "History";
    const next = shown === "Details" ? "History" : "Details";

    await expect(canvas.getByText(`${shown} content`)).toBeVisible();

    await userEvent.click(canvas.getByText(next));
    await expect(args.onTabChange).toHaveBeenCalledOnce();
    await expect(args.onTabChange).toHaveBeenCalledWith(next.toLowerCase());
  },
};
