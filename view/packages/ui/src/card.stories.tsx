import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Settings2, Video } from "lucide-react-native";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import type { CardVariant } from "./card";
import {
  Card,
  CardAction,
  CardArrow,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPill,
  CardTitle,
} from "./card";
import { useThemeColors } from "./lib/theme";

const VARIANTS: CardVariant[] = ["empty", "default", "success", "info", "pending", "alert"];

type CardPropsAndCustomArgs = ComponentProps<typeof Card> & { pill?: string };

function CardBody({ title, pill }: { title: string; pill?: string }) {
  const t = useThemeColors();

  return (
    <>
      <CardHeader>
        <CardTitle icon={Video}>{title}</CardTitle>
        <CardAction>
          <Settings2 size={16} color={t.iconMuted} strokeWidth={1} absoluteStrokeWidth />
        </CardAction>
      </CardHeader>
      <CardContent className="gap-2.5">
        <CardDescription>Content</CardDescription>
        {pill && <CardPill>{pill}</CardPill>}
      </CardContent>
      <CardFooter>
        <CardDescription>Footer</CardDescription>
        <CardArrow />
      </CardFooter>
    </>
  );
}

const meta = {
  title: "UI/Containers and surfaces/Card",
  component: Card,
  args: { variant: "default" },
  argTypes: {
    variant: { control: "inline-radio", options: VARIANTS },
    children: { control: false },
    className: { control: "text" },
  },
  render: ({ pill, ...args }) => (
    <View className="w-[270px]">
      <Card {...args}>
        <CardBody title="Cameras" pill={pill} />
      </Card>
    </View>
  ),
} satisfies Meta<CardPropsAndCustomArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export const Empty: Story = { args: { variant: "empty" } };

export const Success: Story = { args: { variant: "success" } };

export const Info: Story = { args: { variant: "info" } };

export const Pending: Story = { args: { variant: "pending", pill: "Go to networks" } };

export const Alert: Story = { args: { variant: "alert", pill: "Set up" } };

export const DefaultWithPill: Story = { args: { pill: "Set up" } };

export const Pressable: Story = {
  args: { onPress: fn() },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button"));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};

export const Highlighted: Story = { args: { highlighted: true } };
