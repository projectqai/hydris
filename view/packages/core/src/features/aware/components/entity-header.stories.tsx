import { ControlIconButton } from "@hydris/ui/controls";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Settings } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn } from "storybook/test";

import { gateCamera } from "../../../storybook/cameras";
import { camera } from "../../../storybook/entities";
import { MissionHeaderStatus } from "../../mission/components/mission-header-status";
import { EntityHeader } from "./entity-header";

const LONG_ID = "simcam.service.north-perimeter-gate.camera.main-stream-channel-2";

const LONG_LABEL = "Gate camera on the northern perimeter fence beside the vehicle checkpoint";

const unlabelledCamera = camera(LONG_ID, [], { device: gateCamera.device });

const meta = {
  title: "Core/Aware/EntityHeader",
  component: EntityHeader,
  args: { entity: gateCamera, title: "Gate camera" },
  argTypes: {
    entity: { control: false },
    status: { control: false },
    children: { control: false },
  },
  decorators: [
    (Story) => (
      <View className="w-[560px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof EntityHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithStatusAndAction: Story = {
  args: {
    status: <MissionHeaderStatus state={{ variant: "success", label: "Active" }} />,
    children: (
      <ControlIconButton icon={Settings} onPress={fn()} size="sm" accessibilityLabel="Settings" />
    ),
  },
};

export const LongTitleAndIdWrap: Story = {
  args: {
    entity: camera(LONG_ID, [], { label: LONG_LABEL, device: gateCamera.device }),
    title: LONG_LABEL,
    status: <MissionHeaderStatus state={{ variant: "alert", label: "Failed" }} />,
  },
};

export const WithoutLabel: Story = {
  args: {
    entity: unlabelledCamera,
    title: unlabelledCamera.id,
    timestamp: "2m ago",
    status: <MissionHeaderStatus state={{ variant: "alert", label: "Failed" }} />,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(LONG_ID)).toHaveLength(1);
    await expect(canvas.getByText("Failed")).toBeVisible();
    await expect(canvas.getByText("2m ago")).toBeVisible();
  },
};
