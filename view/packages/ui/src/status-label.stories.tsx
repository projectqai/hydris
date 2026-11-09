import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";

import type { CardVariant } from "./card";
import { Card } from "./card";
import type { StatusLabelVariant } from "./status-label";
import { StatusLabel } from "./status-label";

const CARD_VARIANTS: Partial<Record<StatusLabelVariant, CardVariant>> = {
  neutral: "default",
  info: "info",
  success: "success",
  pending: "pending",
  alert: "alert",
};

const meta = {
  title: "UI/Feedback and status/StatusLabel",
  component: StatusLabel,
  args: { variant: "neutral", children: "Inactive" },
  parameters: { layout: "centered" },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: [
        "neutral",
        "info",
        "success",
        "pending",
        "alert",
        "plain-neutral",
        "plain-success",
        "plain-pending",
        "plain-alert",
      ],
    },
    children: { control: "text" },
  },
  render: (args) => {
    const card = CARD_VARIANTS[args.variant ?? "neutral"];

    if (!card) {
      return (
        <View className="w-[270px] items-end p-2.5">
          <StatusLabel {...args} />
        </View>
      );
    }

    return (
      <Card variant={card} className="min-h-0 w-[270px] items-end">
        <StatusLabel {...args} />
      </Card>
    );
  },
} satisfies Meta<typeof StatusLabel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Info: Story = { args: { variant: "info", children: "Scheduled" } };

export const Success: Story = { args: { variant: "success", children: "Active" } };

export const Pending: Story = { args: { variant: "pending", children: "Starting" } };

export const Alert: Story = { args: { variant: "alert", children: "Failed" } };

export const PlainNeutral: Story = { args: { variant: "plain-neutral", children: "Inactive" } };

export const PlainSuccess: Story = { args: { variant: "plain-success", children: "Active" } };

export const PlainPending: Story = { args: { variant: "plain-pending", children: "Starting" } };

export const PlainAlert: Story = { args: { variant: "plain-alert", children: "Failed" } };
