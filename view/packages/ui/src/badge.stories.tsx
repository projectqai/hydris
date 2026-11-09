import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { ShieldCheck } from "lucide-react-native";
import { View } from "react-native";

import { Badge } from "./badge";

const meta = {
  title: "UI/Feedback and status/Badge",
  component: Badge,
  args: { children: "Verified" },
  parameters: { layout: "centered" },
  argTypes: {
    children: { control: "text" },
    icon: {
      control: "select",
      options: ["None", "ShieldCheck"],
      mapping: { None: undefined, ShieldCheck },
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Success: Story = { args: { variant: "success" } };

export const Danger: Story = { args: { variant: "danger" } };

export const Warning: Story = {
  args: { variant: "warning" },
  parameters: { a11y: { test: "todo" } },
};

export const Pending: Story = { args: { variant: "pending" } };

export const Info: Story = { args: { variant: "info" } };

export const AffiliationBlue: Story = { args: { variant: "affiliation-blue" } };

export const AffiliationRed: Story = { args: { variant: "affiliation-red" } };

export const AffiliationNeutral: Story = { args: { variant: "affiliation-neutral" } };

export const AffiliationUnknown: Story = {
  args: { variant: "affiliation-unknown" },
  parameters: { a11y: { test: "todo" } },
};

export const Small: Story = { args: { variant: "info", size: "sm" } };

export const Large: Story = { args: { variant: "info", size: "lg" } };

export const WithIcon: Story = { args: { variant: "success", icon: ShieldCheck } };

export const WithIconSmall: Story = { args: { variant: "success", icon: ShieldCheck, size: "sm" } };

export const WithIconLarge: Story = { args: { variant: "success", icon: ShieldCheck, size: "lg" } };

export const LongLabelInNarrowContainer: Story = {
  args: { variant: "info", children: "Awaiting operator confirmation from sector command" },
  decorators: [
    (Story) => (
      <View className="w-40">
        <Story />
      </View>
    ),
  ],
};
