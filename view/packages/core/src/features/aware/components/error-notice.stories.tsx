import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect } from "storybook/test";

import { ErrorNotice } from "./error-notice";

const meta = {
  title: "Core/Aware/ErrorNotice",
  component: ErrorNotice,
  args: { children: "rtsp handshake refused by 10.0.4.18 after 3 attempts" },
  argTypes: { children: { control: "text" } },
  decorators: [
    (Story) => (
      <View className="w-[560px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ErrorNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toBeVisible();
  },
};

export const LongErrorWraps: Story = {
  args: {
    children:
      "no reply from host after three retries on the backup link, the primary link has " +
      "been down since the last restart and the relay reports its upstream as unreachable",
  },
};
