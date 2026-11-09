import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Building2, Plane, Ship } from "lucide-react-native";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent } from "storybook/test";

import type { OverlayCategoryProps } from "./overlay-category";
import { OverlayCategory } from "./overlay-category";

const affiliations: OverlayCategoryProps["options"] = [
  { id: "hostile", label: "Hostile", color: "red" },
  { id: "unknown", label: "Unknown", color: "yellow" },
  { id: "friendly", label: "Friendly", color: "blue" },
  { id: "neutral", label: "Neutral", color: "green" },
  { id: "pending", label: "Pending", color: "gray" },
];

const domains: OverlayCategoryProps["options"] = [
  { id: "air", label: "Air", icon: Plane },
  { id: "sea", label: "Sea", icon: Ship },
  { id: "infrastructure", label: "Infrastructure", icon: Building2 },
];

const meta = {
  title: "UI/Controls/OverlayCategory",
  component: OverlayCategory,
  args: {
    title: "Affiliation",
    options: affiliations,
    activeStates: { hostile: true, unknown: false, friendly: true, neutral: false, pending: false },
    onToggle: fn(),
  },
  argTypes: {
    options: {
      control: "select",
      options: ["Affiliations", "Domains"],
      mapping: { Affiliations: affiliations, Domains: domains },
    },
  },
  decorators: [
    (Story) => (
      <View className="w-[268px]">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<OverlayCategoryProps>();

    return (
      <OverlayCategory
        {...args}
        onToggle={(id) => {
          args.onToggle(id);
          updateArgs({ activeStates: { ...args.activeStates, [id]: !args.activeStates[id] } });
        }}
      />
    );
  },
} satisfies Meta<typeof OverlayCategory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const IconOptions: Story = {
  args: {
    title: "Domain",
    options: domains,
    activeStates: { air: true, sea: false, infrastructure: true },
  },
};

export const TogglesOption: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Unknown"));
    await expect(args.onToggle).toHaveBeenCalledOnce();
    await expect(args.onToggle).toHaveBeenCalledWith("unknown");
  },
};
