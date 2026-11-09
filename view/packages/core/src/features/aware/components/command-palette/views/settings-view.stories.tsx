import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { fn } from "storybook/test";

import { CONFIG_SCHEMA, entity } from "../../../../../storybook/entities";
import { coreProviders } from "../../../../../storybook/providers";
import { seedEntities } from "../../../../../storybook/seed";
import { SettingsView } from "./settings-view";

const radar = entity("radar-1", {
  device: {},
  configurable: { label: "Radar 1", schema: CONFIG_SCHEMA },
});

const meta = {
  title: "Core/Aware/Command palette/Views/SettingsView",
  component: SettingsView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { entityId: "radar-1", dispatch: fn() },
  beforeEach: () => seedEntities([radar]),
  decorators: [
    (Story) => (
      <View className="native:flex-1 bg-card h-[560px] w-[760px]">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof SettingsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
