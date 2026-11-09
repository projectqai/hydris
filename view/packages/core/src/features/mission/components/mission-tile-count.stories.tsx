import type { CardVariant } from "@hydris/ui/card";
import { Card } from "@hydris/ui/card";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";

import { MissionTileCount } from "./mission-tile-count";

type Args = ComponentProps<typeof MissionTileCount> & { look: CardVariant };

const meta = {
  title: "Core/Mission/MissionTileCount",
  component: MissionTileCount,
  tags: ["!autodocs"],
  args: { value: 4, label: "Devices", look: "default" },
  argTypes: {
    look: { control: "inline-radio", options: ["default", "success", "pending"] },
  },
  parameters: { layout: "centered" },
  render: ({ look, ...args }) => (
    <Card variant={look} className="w-[270px] items-center justify-center">
      <MissionTileCount {...args} />
    </Card>
  ),
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThreeDigits: Story = { args: { look: "success", value: 128 } };
