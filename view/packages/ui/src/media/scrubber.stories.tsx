import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, waitFor } from "storybook/test";

import { drag, tap, trackPoint } from "../storybook/pointer";
import type { ScrubberProps } from "./scrubber";
import { Scrubber } from "./scrubber";

const meta = {
  title: "UI/Media/Scrubber",
  component: Scrubber,
  args: { position: 90, duration: 180, onSeek: fn(), onSeekStart: fn(), onSeekEnd: fn() },
  parameters: { a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="w-72">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<ScrubberProps>();

    return (
      <Scrubber
        {...args}
        onSeek={(position) => {
          args.onSeek(position);
          updateArgs({ position });
        }}
      />
    );
  },
} satisfies Meta<typeof Scrubber>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AtStart: Story = { args: { position: 0 } };

export const AtEnd: Story = { args: { position: 180 } };

export const Disabled: Story = {
  args: { position: 60, disabled: true },
  play: async ({ args, canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Media playback position" });

    await expect(slider).toHaveAttribute("aria-disabled", "true");

    await tap(trackPoint(slider, 0.75));
    await expect(args.onSeek).not.toHaveBeenCalled();
  },
};

export const SeeksOnDrag: Story = {
  args: { position: 42 },
  play: async ({ args, canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Media playback position" });
    const start = trackPoint(slider, args.position / args.duration);

    await drag(start, trackPoint(slider, 42 / 180 + 0.5), { steps: 2, delay: 300 });
    await waitFor(() => expect(args.onSeek).toHaveBeenLastCalledWith(expect.closeTo(132, 0)));
    await expect(args.onSeek).toHaveBeenCalledWith(expect.closeTo((args.position + 132) / 2, 0));
    await expect(args.onSeekStart).toHaveBeenCalled();
    await expect(args.onSeekEnd).toHaveBeenCalled();
  },
};
