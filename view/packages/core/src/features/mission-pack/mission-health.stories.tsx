import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { ListEntitiesResponse } from "@projectqai/proto/world";
import {
  ConfigurableState,
  GetLocalNodeResponseSchema,
  ListEntitiesResponseSchema,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, mocked, userEvent, waitFor } from "storybook/test";

import { worldClient } from "../../lib/api/world-client";
import { runningVideoService, startingFeed } from "../../storybook/cameras";
import { localClock, STORY_NOW } from "../../storybook/clock";
import { configDevice, entity, missionPack, setUpCamera } from "../../storybook/entities";
import { seed, seedEntities } from "../../storybook/seed";
import { MissionHealth } from "./mission-health";
import { useMissionHealthStore } from "./mission-health-store";

const running = [
  ...runningVideoService,
  configDevice("radar-driver", ConfigurableState.ConfigurableStateActive),
];

const inactive = configDevice("relay", ConfigurableState.ConfigurableStateInactive);

const STARTS_AT = STORY_NOW + 10 * 60 * 1000;

const scheduled = configDevice("netscan", ConfigurableState.ConfigurableStateScheduled, {
  configurable: {
    label: "netscan",
    state: ConfigurableState.ConfigurableStateScheduled,
    scheduledAt: timestampFromMs(STARTS_AT),
  },
});

const failed = setUpCamera(
  "dock-camera",
  "Dock camera",
  "video.service",
  ConfigurableState.ConfigurableStateFailed,
  "401 Unauthorized",
);

const meta = {
  title: "Core/Mission pack/MissionHealth",
  component: MissionHealth,
  tags: ["!autodocs"],
  beforeEach: [
    () => seed(useMissionHealthStore, { mission: missionPack() }),
    () => seedEntities(running, { hydrisVersion: "1.8.2", isConnected: true }),
  ],
  decorators: [
    (Story) => (
      <View className="w-[560px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof MissionHealth>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /^Entities loaded\s*214$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Artifacts bundled\s*7$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Electro Optical\s*2$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Other services\s*1$/ })).toBeVisible();
    await expect(canvas.queryByText("Gate camera")).toBeNull();
    await expect(canvas.queryByText("Version mismatch")).toBeNull();
  },
};

export const NoMission: Story = {
  beforeEach: () => seed(useMissionHealthStore, { mission: null }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No mission loaded")).toBeVisible();
  },
};

export const LoadsMissionOnMount: Story = {
  beforeEach: () => {
    seed(useMissionHealthStore, { mission: null });
    mocked(worldClient.getLocalNode).mockResolvedValue(
      create(GetLocalNodeResponseSchema, {
        nodeId: "node-7",
        entity: entity("node-7", { device: { node: { mission: missionPack() } } }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: /^Entities loaded\s*214$/ }),
    ).toBeVisible();
    await expect(worldClient.getLocalNode).toHaveBeenCalledOnce();
  },
};

export const SourceInactive: Story = {
  beforeEach: () => seedEntities([...running, inactive], { isConnected: true }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Other services\s*2$/ }));
    await waitFor(() => expect(canvas.getByText("relay")).toBeVisible());
    await expect(canvas.getByText("Inactive")).toBeVisible();
  },
};

export const SourceScheduled: Story = {
  beforeEach: () => seedEntities([...running, scheduled], { isConnected: true }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Other services\s*2$/ }));
    await waitFor(() =>
      expect(canvas.getByText(`Scheduled · ${localClock(STARTS_AT)}`)).toBeVisible(),
    );
  },
};

export const SourceFailed: Story = {
  beforeEach: () => seedEntities([...running, startingFeed, failed], { isConnected: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText("Failed")).toHaveLength(2);
    await expect(canvas.getByText("Dock camera")).toBeVisible();
    await expect(canvas.getAllByText("401 Unauthorized")).toHaveLength(1);
    await expect(canvas.getByText("uplink-feed")).toBeVisible();
  },
};

export const WithLayouts: Story = {
  beforeEach: () =>
    seed(useMissionHealthStore, {
      mission: missionPack({ layouts: { Sensors: "{}", Overview: "{}" } }),
    }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Layouts loaded\s*2$/ }));
    await waitFor(() => expect(canvas.getByText("Overview")).toBeVisible());
    await expect(canvas.getByText("Sensors")).toBeVisible();
  },
};

export const NoArtifacts: Story = {
  beforeEach: () => seed(useMissionHealthStore, { mission: missionPack({ artifactCount: 0 }) }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Artifacts bundled")).toBeNull();
  },
};

export const VersionMismatch: Story = {
  beforeEach: () => seed(useMissionHealthStore, { mission: missionPack({ packVersion: "1.7.0" }) }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Version mismatch/ }));
    await waitFor(() =>
      expect(canvas.getByText("Pack built with 1.7.0, engine is 1.8.2.")).toBeVisible(),
    );
  },
};

export const EngineVersionUnknown: Story = {
  beforeEach: () => seedEntities(running, { hydrisVersion: null, isConnected: true }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Version mismatch/ }));
    await waitFor(() =>
      expect(canvas.getByText("Pack built with 1.8.2, engine is unknown.")).toBeVisible(),
    );
  },
};

export const NoPackVersion: Story = {
  beforeEach: () => seed(useMissionHealthStore, { mission: missionPack({ packVersion: "" }) }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Version mismatch/ }));
    await waitFor(() =>
      expect(canvas.getByText("Pack did not record which version built it.")).toBeVisible(),
    );
  },
};

export const ListsEntities: Story = {
  beforeEach: () => {
    mocked(worldClient.listEntities).mockResolvedValue(
      create(ListEntitiesResponseSchema, { entities: [entity("trk-9"), entity("mast-2")] }),
    );
  },
  play: async ({ canvas, step }) => {
    const section = () => canvas.getByRole("button", { name: /^Entities loaded\s*214$/ });

    await step("opening lists the world's entities, counted at the time of the fetch", async () => {
      const before = Date.now();

      await userEvent.click(section());
      await waitFor(() => expect(canvas.getByText("trk-9")).toBeVisible());

      const after = Date.now();

      const fetchedAt = canvas
        .getByText(/^2 in world at /)
        .textContent?.match(/at (\d\d:\d\d:\d\d)\./);

      await expect([localClock(before), localClock(after)]).toContain(fetchedAt?.[1]);
      await expect(canvas.getAllByText(/^(mast-2|trk-9)$/).map((item) => item.textContent)).toEqual(
        ["mast-2", "trk-9"],
      );
      await expect(worldClient.listEntities).toHaveBeenCalledOnce();
    });

    await step("reopening fetches again and shows no number until it answers", async () => {
      const { promise, resolve } = Promise.withResolvers<ListEntitiesResponse>();

      mocked(worldClient.listEntities).mockReturnValueOnce(promise);
      await userEvent.click(section());
      await waitFor(() => expect(canvas.queryByText("trk-9")).toBeNull());
      await userEvent.click(section());
      await waitFor(() => expect(canvas.getByText("Loading…")).toBeVisible());
      await expect(canvas.queryByText(/in world at/)).toBeNull();

      resolve(
        create(ListEntitiesResponseSchema, {
          entities: [entity("trk-9"), entity("mast-2"), entity("relay-4")],
        }),
      );
      await waitFor(() => expect(canvas.getByText(/^3 in world at /)).toBeVisible());
      await expect(worldClient.listEntities).toHaveBeenCalledTimes(2);
    });
  },
};

export const EntityListLoading: Story = {
  beforeEach: () => {
    mocked(worldClient.listEntities).mockReturnValue(new Promise<ListEntitiesResponse>(() => {}));
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Entities loaded/ }));
    await waitFor(() => expect(canvas.getByText("Loading…")).toBeVisible());
    await expect(worldClient.listEntities).toHaveBeenCalledOnce();
  },
};

export const EntityListUnreachable: Story = {
  play: async ({ canvas }) => {
    const { promise, reject } = Promise.withResolvers<ListEntitiesResponse>();

    mocked(worldClient.listEntities).mockReturnValue(promise);
    await userEvent.click(canvas.getByRole("button", { name: /^Entities loaded/ }));
    await waitFor(() => expect(canvas.getByText("Loading…")).toBeVisible());

    reject(new Error("Engine unreachable"));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Engine unreachable");
    await expect(canvas.queryByText("Loading…")).toBeNull();
    await expect(canvas.queryByText(/in world at/)).toBeNull();
  },
};
