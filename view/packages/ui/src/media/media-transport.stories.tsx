import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { useArgs } from "storybook/preview-api";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { drag, trackPoint } from "../storybook/pointer";
import { MediaTransport } from "./media-transport";
import type { MediaTransportProps } from "./types";

const meta = {
  title: "UI/Media/MediaTransport",
  component: MediaTransport,
  args: {
    playing: false,
    position: 37,
    duration: 184,
    isLoaded: true,
    seekable: true,
    onTogglePlay: fn(),
    onSeek: fn(),
    onSeekStart: fn(),
    onSeekEnd: fn(),
  },
  parameters: { a11y: { test: "todo" } },
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<MediaTransportProps>();
    const props: MediaTransportProps = args.seekable
      ? {
          ...args,
          onSeek: (position: number) => {
            args.onSeek(position);
            updateArgs({ position });
          },
        }
      : args;

    return (
      <MediaTransport
        {...props}
        onTogglePlay={() => {
          args.onTogglePlay();
          updateArgs({ playing: !args.playing });
        }}
      />
    );
  },
} satisfies Meta<typeof MediaTransport>;

export default meta;

type Story = StoryObj<typeof MediaTransport>;

export const Default: Story = {};

export const NotLoaded: Story = {
  args: {
    position: 0,
    duration: 0,
    isLoaded: false,
    seekable: false,
    onSeek: undefined,
    onSeekStart: undefined,
    onSeekEnd: undefined,
  },
  play: async ({ args, canvas }) => {
    const button = canvas.getByLabelText("Play media");

    await expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup({ pointerEventsCheck: 0 }).click(button);
    await expect(args.onTogglePlay).not.toHaveBeenCalled();
  },
};

export const LoadedNotSeekable: Story = {
  args: {
    playing: true,
    position: 12,
    duration: 60,
    seekable: false,
    onSeek: undefined,
    onSeekStart: undefined,
    onSeekEnd: undefined,
  },
  play: async ({ canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Media playback position" });

    await expect(canvas.getByLabelText("Pause media")).not.toHaveAttribute("aria-disabled");
    await expect(slider).toHaveAttribute("aria-disabled", "true");
  },
};

export const LongDurationInNarrowContainer: Story = {
  args: { position: 4512, duration: 7384 },
  decorators: [
    (Story) => (
      <View className="w-60">
        <Story />
      </View>
    ),
  ],
};

export const PressesPause: Story = {
  args: { playing: true },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText(args.playing ? "Pause media" : "Play media"));
    await expect(args.onTogglePlay).toHaveBeenCalledOnce();
  },
};

export const SeeksOnDrag: Story = {
  play: async ({ args, canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Media playback position" });
    const start = trackPoint(slider, args.position / args.duration);
    const end = trackPoint(slider, 37 / 184 + 0.5);

    await drag(start, end, { steps: 2 });
    await waitFor(() => expect(args.onSeek).toHaveBeenLastCalledWith(expect.closeTo(129, 0)));
    await expect(args.onSeekStart).toHaveBeenCalled();
    await expect(args.onSeekEnd).toHaveBeenCalled();
  },
};
