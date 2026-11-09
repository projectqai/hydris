import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@hydris/ui/card";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Radar } from "lucide-react-native";
import { View } from "react-native";

import { MissionTileGrid, MissionTileGridItem, useTileColumns } from "./mission-tile-grid";
import { MissionTileMessage } from "./mission-tile-message";

const LABELS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"];

type Args = { tileCount: number; frame: string };

function TileGrid({ tileCount, frame }: Args) {
  const grid = useTileColumns(tileCount);

  return (
    <View className={frame}>
      <MissionTileGrid {...grid}>
        {LABELS.slice(0, tileCount).map((label) => (
          <MissionTileGridItem key={label}>
            <Card variant="empty">
              <CardHeader>
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <MissionTileMessage icon={Radar} label={label} />
              </CardContent>
              <CardFooter />
            </Card>
          </MissionTileGridItem>
        ))}
      </MissionTileGrid>
    </View>
  );
}

const meta = {
  title: "Core/Mission/MissionTileGrid",
  args: { tileCount: 1, frame: "h-[440px] w-[560px]" },
  argTypes: { tileCount: { control: { type: "range", min: 1, max: 7 } } },
  parameters: { layout: "centered" },
  render: (args) => <TileGrid {...args} />,
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
