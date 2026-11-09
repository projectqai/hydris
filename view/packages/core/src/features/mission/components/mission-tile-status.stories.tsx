import type { CardVariant } from "@hydris/ui/card";
import { Card } from "@hydris/ui/card";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps } from "react";

import { MissionTileStatus } from "./mission-tile-status";

type Args = ComponentProps<typeof MissionTileStatus> & { look: CardVariant };

const meta = {
  title: "Core/Mission/MissionTileStatus",
  component: MissionTileStatus,
  tags: ["!autodocs"],
  args: { state: { label: "Active" }, look: "empty" },
  argTypes: {
    look: { control: "inline-radio", options: ["empty", "default", "success", "pending", "alert"] },
    variant: { control: "inline-radio", options: ["default", "success", "pending", "alert"] },
  },
  parameters: { layout: "centered" },
  render: ({ look, ...args }) => (
    <Card variant={look} className="min-h-0 w-[270px] items-end">
      <MissionTileStatus {...args} />
    </Card>
  ),
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RowInactiveOnRunningTile: Story = {
  args: { look: "success", variant: "default", state: { label: "Inactive" } },
};

export const RowActiveOnPendingTile: Story = { args: { look: "pending", variant: "success" } };

export const RowPendingOnRunningTile: Story = {
  args: { look: "success", variant: "pending", state: { label: "Pending" } },
};

export const RowFailedOnRunningTile: Story = {
  args: { look: "success", variant: "alert", state: { label: "Failed" } },
};
