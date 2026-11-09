import type { CardVariant } from "@hydris/ui/card";
import { Card } from "@hydris/ui/card";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Radar, TriangleAlert } from "lucide-react-native";
import type { ComponentProps } from "react";

import { MissionTileMessage } from "./mission-tile-message";

type Args = ComponentProps<typeof MissionTileMessage> & { look: CardVariant };

const meta = {
  title: "Core/Mission/MissionTileMessage",
  component: MissionTileMessage,
  tags: ["!autodocs"],
  args: { icon: Radar, label: "Add sources", look: "empty" },
  argTypes: {
    icon: { control: false },
    look: { control: "inline-radio", options: ["empty", "default", "success", "pending", "alert"] },
  },
  parameters: { layout: "centered" },
  render: ({ look, ...args }) => (
    <Card variant={look} className="w-[270px] items-center justify-center">
      <MissionTileMessage {...args} />
    </Card>
  ),
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongLabelCutAtTwoLines: Story = {
  args: {
    look: "alert",
    icon: TriangleAlert,
    label: "Loading dock north entrance camera behind the second gate, mounted on the east wall",
  },
};
