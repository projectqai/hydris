import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { setStringAsync } from "expo-clipboard";
import { Clock, MapPin } from "lucide-react-native";
import { View } from "react-native";
import { expect, screen, userEvent } from "storybook/test";

import { Badge } from "./badge";
import { InfoRow } from "./info-row";

const meta = {
  title: "UI/Text and data/InfoRow",
  component: InfoRow,
  args: { label: "Callsign", value: "TANGO 21" },
  argTypes: {
    value: { control: "text" },
    icon: {
      control: "select",
      options: ["None", "MapPin", "Clock"],
      mapping: { None: undefined, MapPin, Clock },
    },
  },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof InfoRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = {
  args: { icon: MapPin, label: "Position", value: "51.5072 N, 0.1276 W" },
};

export const MonoWithCopy: Story = {
  args: { label: "Entity ID", value: "trk-0x1F4A", mono: true, onCopy: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy to clipboard" }));
    await expect(setStringAsync).toHaveBeenCalledWith("trk-0x1F4A");
    await expect(await screen.findByText("Copied to clipboard")).toBeInTheDocument();
  },
};

export const CopiesCopyValue: Story = {
  args: {
    label: "Position",
    value: "51.51 N, 0.13 W",
    copyValue: "51.507200, -0.127600",
    mono: true,
    onCopy: true,
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Copy to clipboard" }));
    await expect(setStringAsync).toHaveBeenCalledWith("51.507200, -0.127600");
    await expect(await screen.findByText("Copied to clipboard")).toBeInTheDocument();
  },
};

export const LongValueInNarrowContainer: Story = {
  args: { label: "Source", value: "sensor-array-north-perimeter-station-04-secondary-uplink" },
  decorators: [
    (Story) => (
      <View className="w-64">
        <Story />
      </View>
    ),
  ],
};

export const NodeValue: Story = {
  args: { label: "Status" },
  render: (args) => (
    <InfoRow
      {...args}
      value={
        <Badge variant="success" size="sm">
          Tracking
        </Badge>
      }
    />
  ),
};
