import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { KeyboardProvider } from "../keyboard";
import { ListDetailShell } from "./list-detail-drawer";

const deviceList = (
  <View className="gap-1 p-3">
    <Text className="text-foreground font-sans-medium text-sm">Radar 1</Text>
    <Text className="text-foreground font-sans-medium text-sm">Camera 2</Text>
    <Text className="text-foreground font-sans-medium text-sm">Weather station</Text>
  </View>
);

const deviceDetail = (
  <View className="flex-1 p-4">
    <Text className="text-foreground font-sans-semibold text-base">Radar 1</Text>
    <Text className="text-foreground/75 font-sans text-sm">Online, last report 2 s ago</Text>
  </View>
);

const meta = {
  title: "UI/Layout/ListDetailShell",
  component: ListDetailShell,
  args: {
    isWide: true,
    treeOpen: true,
    closeLabel: "Close device list",
    onTreeClose: fn(),
    sidebar: deviceList,
    children: deviceDetail,
  },
  argTypes: {
    sidebar: {
      control: "select",
      options: ["DeviceList", "None"],
      mapping: { DeviceList: deviceList, None: null },
    },
    children: {
      control: "select",
      options: ["DeviceDetail", "None"],
      mapping: { DeviceDetail: deviceDetail, None: null },
    },
  },
  decorators: [
    (Story) => (
      <KeyboardProvider>
        <View className="border-border native:flex-1 native:w-full h-64 w-[720px] overflow-hidden rounded-lg border">
          <Story />
        </View>
      </KeyboardProvider>
    ),
  ],
} satisfies Meta<typeof ListDetailShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WideListClosed: Story = { args: { treeOpen: false } };

export const NarrowDrawerClosesOnScrimPress: Story = {
  args: { isWide: false },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await waitFor(() => expect(canvas.getByLabelText("Close device list")).toBeVisible());
    await userEvent.click(canvas.getByLabelText("Close device list"));
    await expect(args.onTreeClose).toHaveBeenCalledOnce();
  },
};

export const NarrowDrawerClosesOnEscape: Story = {
  args: { isWide: false },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await waitFor(() => expect(canvas.getByLabelText("Close device list")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await expect(args.onTreeClose).toHaveBeenCalledOnce();
  },
};
