import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Signal } from "lucide-react-native";
import { View } from "react-native";

import { Badge } from "./badge";
import { useThemeColors } from "./lib/theme";
import type { TileHeaderContent, TileHeaderSizes } from "./tile-header";
import { TileHeader } from "./tile-header";

function SignalMeta({ sizes }: { sizes: TileHeaderSizes }) {
  const t = useThemeColors();

  return <Signal size={sizes.icon} strokeWidth={2} color={t.iconMuted} />;
}

const signalMeta = (sizes: TileHeaderSizes) => <SignalMeta sizes={sizes} />;

const linkQuality: TileHeaderContent = {
  name: "Link quality",
  timestamp: "12:04:31Z",
  meta: signalMeta,
};

const badgeMeta: TileHeaderContent = {
  name: "Engine",
  meta: () => (
    <Badge variant="success" size="sm">
      Nominal
    </Badge>
  ),
};

const meta = {
  title: "UI/Containers and surfaces/TileHeader",
  component: TileHeader,
  args: { content: { name: "Battery" } },
  argTypes: {
    content: {
      control: "select",
      options: ["Battery", "LinkQuality", "BadgeMeta"],
      mapping: { Battery: { name: "Battery" }, LinkQuality: linkQuality, BadgeMeta: badgeMeta },
    },
  },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof TileHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTimestampAndMeta: Story = { args: { content: linkQuality } };

export const BadgeAsMeta: Story = { args: { content: badgeMeta } };

export const LongNameInNarrowContainer: Story = {
  args: { content: { name: "Perimeter radar station 04 coverage", timestamp: "12:04:31Z" } },
  decorators: [
    (Story) => (
      <View className="w-56">
        <Story />
      </View>
    ),
  ],
};

export const CustomSizes: Story = {
  args: {
    sizes: { name: 18, text: 15, icon: 20, gap: 12 },
    content: { name: "Altitude", timestamp: "12:04:31Z", meta: signalMeta },
  },
};

export const MissingName: Story = {
  args: { content: { name: undefined, timestamp: "12:04:31Z" } },
};
