import { ClassificationIdentity, ConfigurableState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { dockWebcam, track, webcams } from "../../../../../storybook/entities";
import { paletteView } from "../../../../../storybook/palette-view";
import { seedEntities } from "../../../../../storybook/seed";
import { MissionView } from "./mission-view";

const meta = {
  title: "Core/Aware/Command palette/Views/MissionView",
  component: MissionView,
  tags: ["!autodocs"],
  argTypes: { dispatch: { control: false } },
  args: { dispatch: fn() },
  decorators: [paletteView()],
} satisfies Meta<typeof MissionView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, step }) => {
    await step("with nothing set up, Sources offers to add sources", async () => {
      await expect(canvas.getByRole("button", { name: /^Sources/ })).toHaveTextContent(
        /^SourcesAdd sources$/,
      );
    });

    await step("with no tracks, Tracks shows its empty look", async () => {
      await expect(canvas.getByRole("button", { name: /^Tracks/ })).toHaveTextContent(
        /^TracksTracks$/,
      );
    });

    await step("Enter opens nothing before a tile is highlighted", async () => {
      await userEvent.keyboard("{Enter}");
      await expect(args.dispatch).not.toHaveBeenCalled();
    });

    await step("the first arrow highlights Sources and Enter opens it", async () => {
      await userEvent.keyboard("{ArrowRight}{Enter}");
      await expect(args.dispatch).toHaveBeenCalledOnce();
      await expect(args.dispatch).toHaveBeenCalledWith({ type: "push", mode: { kind: "sources" } });
    });
  },
};

export const CountsTracks: Story = {
  beforeEach: () =>
    seedEntities([
      track("trk-1", ClassificationIdentity.ClassificationIdentityHostile),
      track("trk-2", ClassificationIdentity.ClassificationIdentityFriend),
      track("trk-3", ClassificationIdentity.ClassificationIdentityNeutral),
    ]),
  play: async ({ args, canvas, step }) => {
    await step("the Tracks tile counts the tracks, with no state", async () => {
      await expect(canvas.getByRole("button", { name: /^Tracks/ })).toHaveTextContent(
        /^Tracks03Tracks$/,
      );
    });

    await step("pressing it opens the track list", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /^Tracks/ }));
      await expect(args.dispatch).toHaveBeenCalledOnce();
      await expect(args.dispatch).toHaveBeenCalledWith({ type: "push", mode: { kind: "tracks" } });
    });
  },
};

export const SourceStartsFailing: Story = {
  beforeEach: () =>
    seedEntities([...webcams(), dockWebcam(ConfigurableState.ConfigurableStateActive)], {
      isConnected: true,
    }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Sources/ })).toHaveTextContent(
      /^SourcesActive02Devices$/,
    );

    seedEntities(
      [...webcams(), dockWebcam(ConfigurableState.ConfigurableStateFailed, "no frames")],
      {
        isConnected: true,
      },
    );
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: /^Sources/ })).toHaveTextContent(
        /^SourcesFailedFailed$/,
      ),
    );
  },
};
