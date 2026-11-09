import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { holdToConfirmEnabled } from "@hydris/ui/hooks/hold-to-confirm-flag";
import { CONFIRM_LAPSE_MS } from "@hydris/ui/hooks/use-confirm-press";
import { center, tap } from "@hydris/ui/storybook/pointer";
import { IGNORE_HIDDEN } from "@hydris/ui/storybook/queries";
import {
  CancelTaskResponseSchema,
  ClassificationIdentity,
  DeviceState,
  LinkStatus,
  RunTaskResponseSchema,
  TaskExecutionState,
  TaskStatus,
} from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, mocked, screen, userEvent, waitFor } from "storybook/test";

import { worldClient } from "../../../../lib/api/world-client";
import {
  ago,
  ahead,
  elapseHeldTimeouts,
  holdTimeouts,
  nextFrame,
  nextFresh,
} from "../../../../storybook/clock";
import type { EntityInit } from "../../../../storybook/entities";
import { asset, entity, taskable, track } from "../../../../storybook/entities";
import { coreProviders, paletteOpener } from "../../../../storybook/providers";
import { acceptRuns, answerRunLater } from "../../../../storybook/requests";
import { seed, seedEntities } from "../../../../storybook/seed";
import { exactToasts } from "../../../../storybook/toasts";
import type { PaletteContextValue } from "../../palette-context";
import { useSelectionStore } from "../../store/selection-store";
import { DONE_SHOWN_MS, RUN_TEXT } from "../../utils/task-feedback";
import { ActionsSection } from "./actions-section";
import { EntityActionButtons } from "./entity-action-buttons";

type Args = { onOpenPalette: PaletteContextValue["open"] };

type User = ReturnType<typeof userEvent.setup>;

const hostile = track("trk-1", ClassificationIdentity.ClassificationIdentityHostile);
const camera = asset("cam-1", DeviceState.DeviceStateActive, LinkStatus.LinkStatusConnected);

const POINT_EFFECT = "Turns the camera onto the selected track";
const RESTART_EFFECT = "Reconnects the camera's video feed";

function cameraAction(
  id: string,
  label: string,
  action: { effect?: string; disabled?: string },
  init: EntityInit = {},
) {
  return taskable(id, label, [camera.id], {
    taskable: { label, priority: 1, context: [{ entityId: camera.id }], ...action },
    ...init,
  });
}

const pointCamera = cameraAction("task-1", "Point camera at track", { effect: POINT_EFFECT });

function restartStream(init: EntityInit = {}) {
  return cameraAction("task-2", "Restart stream", { effect: RESTART_EFFECT }, init);
}

function reportRestart(state: TaskExecutionState, reason?: string) {
  seedEntities([
    camera,
    pointCamera,
    restartStream({ lifetime: { fresh: nextFresh() }, taskExecution: { state, reason } }),
  ]);
}

const selected = (entityId: string, isFollowing = false) =>
  seed(useSelectionStore, { selectedEntityId: entityId, isFollowing });

const twoTaskables = () => seedEntities([camera, pointCamera, restartStream()]);

const button = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

async function holdToRun(user: User, target: HTMLElement) {
  await user.click(target);
  await screen.findByText("Hold to confirm", IGNORE_HIDDEN);
  await user.pointer({ keys: "[MouseLeft>]", target });
  await waitFor(() => expect(worldClient.runTask).toHaveBeenCalled(), { timeout: 2_000 });
  await user.pointer({ keys: "[/MouseLeft]", target });
}

const meta = {
  title: "Core/Aware/Entity details/EntityActionButtons",
  component: EntityActionButtons,
  subcomponents: { ActionsSection },
  tags: ["!autodocs"],
  args: { onOpenPalette: fn() },
  decorators: [
    (Story) => (
      <View className="w-64">
        <Story />
      </View>
    ),
    paletteOpener(),
    coreProviders(),
  ],
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: [() => seedEntities([hostile]), () => selected("trk-1")],
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Follow entity")).toBeVisible();
    await expect(canvas.queryByLabelText("Configure device")).toBeNull();
  },
};

export const Following: Story = {
  beforeEach: [() => seedEntities([hostile]), () => selected("trk-1", true)],
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Stop following entity")).toBeVisible();
    await expect(canvas.getByText("Following")).toBeVisible();
  },
};

export const Follows: Story = {
  beforeEach: [() => seedEntities([hostile]), () => selected("trk-1")],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Follow entity"));
    await expect(canvas.getByLabelText("Stop following entity")).toBeVisible();
  },
};

export const StopsFollowing: Story = {
  beforeEach: [() => seedEntities([hostile]), () => selected("trk-1", true)],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Stop following entity"));
    await expect(canvas.getByLabelText("Follow entity")).toBeVisible();
  },
};

export const Device: Story = {
  beforeEach: [() => seedEntities([camera]), () => selected("cam-1")],
  play: async ({ args, canvas }) => {
    await expect(canvas.queryByLabelText("Follow entity")).toBeNull();

    await userEvent.click(canvas.getByLabelText("Configure device"));
    await expect(args.onOpenPalette).toHaveBeenCalledOnce();
    await expect(args.onOpenPalette).toHaveBeenCalledWith({
      kind: "config",
      entityId: "cam-1",
    });
  },
};

export const DeviceWithTaskables: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        pointCamera,
        restartStream({ taskExecution: { state: TaskExecutionState.TaskExecutionStateRunning } }),
        taskable("task-3", "Sweep sector", ["radar-1"]),
      ]),
    () => selected("cam-1"),
  ],
  play: async ({ canvas }) => {
    await expect(button("Point camera at track")).toHaveTextContent(POINT_EFFECT);
    await expect(button("Restart stream")).toHaveTextContent("Running");
    await expect(button("Restart stream")).not.toHaveTextContent(RESTART_EFFECT);
    await expect(canvas.queryByText("Sweep sector")).toBeNull();
  },
};

export const TapArms: Story = {
  beforeEach: [twoTaskables, () => selected("cam-1")],
  play: async () => {
    await userEvent.click(button("Point camera at track"));

    await expect(await screen.findByText("Hold to confirm", IGNORE_HIDDEN)).toBeVisible();
    await expect(worldClient.runTask).not.toHaveBeenCalled();
  },
};

export const TapLapsesWithoutHold: Story = {
  beforeEach: [twoTaskables, () => selected("cam-1"), () => holdTimeouts(CONFIRM_LAPSE_MS)],
  play: async () => {
    await userEvent.click(button("Point camera at track"));
    await screen.findByText("Hold to confirm", IGNORE_HIDDEN);

    elapseHeldTimeouts();

    await waitFor(() => expect(screen.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
    await expect(button("Point camera at track")).toHaveTextContent(POINT_EFFECT);
    await expect(worldClient.runTask).not.toHaveBeenCalled();
  },
};

export const TapRunsWithoutHold: Story = {
  beforeEach: [
    twoTaskables,
    () => selected("cam-1"),
    acceptRuns,
    () => {
      mocked(holdToConfirmEnabled).mockReturnValue(false);
    },
  ],
  play: async () => {
    const user = userEvent.setup();

    await user.click(button("Restart stream"));
    await expect(worldClient.runTask).toHaveBeenCalledOnce();
    await expect(worldClient.runTask).toHaveBeenCalledWith({ entityId: "task-2" });
    await expect(screen.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();

    const point = button("Point camera at track");

    await user.pointer({ keys: "[MouseLeft>]", target: point });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(screen.queryByTestId("hold-fill")).toBeNull();
    await expect(worldClient.runTask).toHaveBeenCalledOnce();

    await user.pointer({ keys: "[/MouseLeft]", target: point });
    await expect(worldClient.runTask).toHaveBeenCalledTimes(2);
    await expect(worldClient.runTask).toHaveBeenLastCalledWith({ entityId: "task-1" });
  },
};

export const HoldRuns: Story = {
  beforeEach: [twoTaskables, () => selected("cam-1"), acceptRuns],
  play: async () => {
    const user = userEvent.setup();

    await holdToRun(user, button("Point camera at track"));

    await expect(worldClient.runTask).toHaveBeenCalledOnce();
    await expect(worldClient.runTask).toHaveBeenCalledWith({ entityId: "task-1" });
  },
};

const spawnedRestart = entity("run-9", {
  lifetime: { from: ago(60) },
  taskExecution: { task: "task-2", state: TaskExecutionState.TaskExecutionStateRunning },
});

const pendingRestart = entity("run-9", {
  lifetime: { from: ago(60) },
  taskExecution: { task: "task-2", state: TaskExecutionState.TaskExecutionStatePending },
});

const olderDoneRestart = entity("run-8", {
  lifetime: { from: ago(120), fresh: ago(120) },
  taskExecution: { task: "task-2", state: TaskExecutionState.TaskExecutionStateCompleted },
});

export const EarlierRunsListUnderTheButton: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream(),
        spawnedRestart,
        entity("run-8", {
          lifetime: { from: ago(120), fresh: ago(120) },
          taskExecution: {
            task: "task-2",
            state: TaskExecutionState.TaskExecutionStateCompleted,
            reason: "3 frames saved",
          },
        }),
      ]),
    () => selected("cam-1"),
  ],
  play: async () => {
    await expect(button("Restart stream")).toHaveTextContent("Running");
    await expect(await screen.findByText("3 frames saved")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Clear Restart stream result" }));
    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-8" });
  },
};

export const DismissKeepsOlderSuccessQuiet: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream(),
        olderDoneRestart,
        entity("run-9", {
          lifetime: { from: ago(60), fresh: ago(60) },
          taskExecution: {
            task: "task-2",
            state: TaskExecutionState.TaskExecutionStateFailed,
            reason: "Stream source offline",
          },
        }),
      ]),
    () => selected("cam-1"),
  ],
  play: async () => {
    await expect(await screen.findByRole("alert")).toHaveTextContent("Stream source offline");

    await userEvent.click(button("Restart stream"));
    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-9" });
    seedEntities([camera, restartStream(), olderDoneRestart]);

    await nextFrame();
    await expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT);
    await expect(button("Restart stream")).not.toHaveTextContent("Done.");
  },
};

export const RunningRunShowsWhatItDoes: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream(),
        entity("run-9", {
          lifetime: { from: ago(60) },
          taskExecution: {
            task: "task-2",
            state: TaskExecutionState.TaskExecutionStateRunning,
            reason: "Reconnecting to the encoder",
          },
        }),
      ]),
    () => selected("cam-1"),
  ],
  play: async () => {
    await expect(button("Restart stream")).toHaveTextContent("Reconnecting to the encoder");
    await expect(button("Restart stream")).not.toHaveTextContent(RUN_TEXT.cancel);

    await userEvent.click(button("Restart stream"));
    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-9" });
  },
};

export const CancelRefused: Story = {
  beforeEach: [
    () => seedEntities([camera, restartStream(), pendingRestart]),
    () => selected("cam-1"),
  ],
  play: async () => {
    await userEvent.click(button("Restart stream"));

    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-9" });
    await expect(
      await screen.findByText("worldClient.cancelTask called from a story"),
    ).toBeInTheDocument();
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancel));
  },
};

export const CancelShowsUntilRunEnds: Story = {
  beforeEach: [
    () => seedEntities([camera, restartStream(), pendingRestart]),
    () => selected("cam-1"),
    () => {
      mocked(worldClient.cancelTask).mockResolvedValue(create(CancelTaskResponseSchema, {}));
    },
  ],
  play: async () => {
    await userEvent.click(button("Restart stream"));

    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-9" });
    await nextFrame();
    await expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancelling);

    seedEntities([camera, restartStream()]);
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));
  },
};

const acceptCancels = () => {
  mocked(worldClient.cancelTask).mockResolvedValue(create(CancelTaskResponseSchema, {}));
};

export const CancelBeforeRunArrives: Story = {
  beforeEach: [
    twoTaskables,
    () => selected("cam-1"),
    acceptCancels,
    () => {
      mocked(worldClient.runTask).mockResolvedValue(
        create(RunTaskResponseSchema, {
          executionId: "run-7",
          status: TaskStatus.TaskStatusRunning,
        }),
      );
    },
  ],
  play: async () => {
    await holdToRun(userEvent.setup(), button("Restart stream"));
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancel));

    await userEvent.click(button("Restart stream"));
    await waitFor(() =>
      expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-7" }),
    );
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));

    seedEntities([
      camera,
      pointCamera,
      restartStream(),
      entity("run-7", {
        lifetime: { from: ago(1), until: ago(1) },
        taskExecution: { task: "task-2", state: TaskExecutionState.TaskExecutionStatePending },
      }),
    ]);
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancelling));

    seedEntities([camera, pointCamera, restartStream()]);
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));
  },
};

export const CancelWhileRunRequested: Story = {
  beforeEach: [twoTaskables, () => selected("cam-1"), acceptCancels],
  play: async () => {
    const user = userEvent.setup();
    const { answer, fail } = answerRunLater("run-7");

    await holdToRun(user, button("Restart stream"));
    await userEvent.click(button("Restart stream"));
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancelling));

    fail();
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));
    await expect(worldClient.cancelTask).not.toHaveBeenCalled();

    mocked(worldClient.runTask).mockClear();
    await holdToRun(user, button("Restart stream"));
    await userEvent.click(button("Restart stream"));

    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancelling));
    await expect(worldClient.cancelTask).not.toHaveBeenCalled();

    answer();
    await waitFor(() =>
      expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "run-7" }),
    );
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));
  },
};

const TEN_HOURS = 10 * 60 * 60;

export const RunProgress: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream({
          taskExecution: {
            state: TaskExecutionState.TaskExecutionStateRunning,
            progress: 40,
            eta: ahead(TEN_HOURS),
          },
        }),
        pointCamera,
        entity("run-4", {
          lifetime: { from: ago(3 * TEN_HOURS) },
          taskExecution: {
            task: "task-1",
            state: TaskExecutionState.TaskExecutionStateRunning,
            eta: ahead(TEN_HOURS),
          },
        }),
        cameraAction(
          "task-5",
          "Refocus lens",
          {},
          {
            lifetime: { from: ago(TEN_HOURS) },
            taskExecution: {
              state: TaskExecutionState.TaskExecutionStateRunning,
              eta: ahead(TEN_HOURS),
            },
          },
        ),
      ]),
    () => selected("cam-1"),
  ],
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("progressbar", { name: "Restart stream progress" }),
    ).toHaveAttribute("aria-valuenow", "40");
    await expect(
      canvas.getByRole("progressbar", { name: "Point camera at track progress" }),
    ).toHaveAttribute("aria-valuenow", "75");
    await expect(canvas.queryByRole("progressbar", { name: "Refocus lens progress" })).toBeNull();
  },
};

export const CompletedShowsDone: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream({ taskExecution: { state: TaskExecutionState.TaskExecutionStateRunning } }),
      ]),
    () => selected("cam-1"),
    () => holdTimeouts(DONE_SHOWN_MS),
  ],
  play: async () => {
    reportRestart(TaskExecutionState.TaskExecutionStateCompleted, "Stream back online");

    await waitFor(() => expect(button("Restart stream")).toHaveTextContent("Done."));

    elapseHeldTimeouts();
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));
  },
};

export const EarlierSuccessStaysQuiet: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream({ taskExecution: { state: TaskExecutionState.TaskExecutionStateCompleted } }),
      ]),
    () => selected("cam-1"),
  ],
  play: async () => {
    await expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT);
    await expect(button("Restart stream")).not.toHaveTextContent("Done.");
  },
};

export const EarlierFailureShows: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        restartStream({
          taskExecution: {
            state: TaskExecutionState.TaskExecutionStateFailed,
            reason: "Stream source offline",
          },
        }),
      ]),
    () => selected("cam-1"),
  ],
  play: async () => {
    await expect(await screen.findByRole("alert")).toHaveTextContent("Stream source offline");
  },
};

const runningRestart = () =>
  seedEntities([
    camera,
    pointCamera,
    restartStream({ taskExecution: { state: TaskExecutionState.TaskExecutionStateRunning } }),
  ]);

export const FailureShowsAndDismisses: Story = {
  beforeEach: [runningRestart, () => selected("cam-1")],
  play: async () => {
    reportRestart(TaskExecutionState.TaskExecutionStateFailed, "Stream source offline");

    await expect(await screen.findByRole("alert")).toHaveTextContent("Stream source offline");

    await userEvent.click(button("Restart stream"));
    await expect(
      await screen.findByText("worldClient.cancelTask called from a story"),
    ).toBeInTheDocument();
    await nextFrame();
    await expect(screen.getByRole("alert")).toHaveTextContent("Stream source offline");

    mocked(worldClient.cancelTask).mockResolvedValue(create(CancelTaskResponseSchema, {}));
    await userEvent.click(button("Restart stream"));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT);
    await expect(worldClient.cancelTask).toHaveBeenCalledTimes(2);
    await expect(worldClient.cancelTask).toHaveBeenLastCalledWith({ executionId: "task-2" });
  },
};

export const UnavailableRefuses: Story = {
  beforeEach: [
    () =>
      seedEntities([
        camera,
        cameraAction("task-2", "Restart stream", {
          effect: RESTART_EFFECT,
          disabled: "Camera is rebooting",
        }),
      ]),
    () => selected("cam-1"),
  ],
  play: async () => {
    const restart = button("Restart stream");

    await expect(restart).toHaveAttribute("aria-disabled", "true");
    await expect(restart).toHaveTextContent("Camera is rebooting");
    await expect(screen.queryByRole("alert")).toBeNull();

    await tap(center(restart));

    await expect(await screen.findByRole("alert")).toHaveTextContent("Camera is rebooting");
    await expect(screen.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();
    await expect(worldClient.runTask).not.toHaveBeenCalled();

    await userEvent.click(button("Restart stream"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  },
};

export const RunFails: Story = {
  beforeEach: [twoTaskables, () => selected("cam-1")],
  play: async () => {
    await holdToRun(userEvent.setup(), button("Restart stream"));

    await expect(
      await screen.findByText("worldClient.runTask called from a story"),
    ).toBeInTheDocument();
    await expect(worldClient.runTask).toHaveBeenCalledOnce();
    await expect(worldClient.runTask).toHaveBeenCalledWith({ entityId: "task-2" });
  },
};

export const RunAlreadyRunning: Story = {
  beforeEach: [
    twoTaskables,
    () => selected("cam-1"),
    () => {
      mocked(worldClient.runTask).mockRejectedValue(
        new ConnectError("task is already being executed", Code.AlreadyExists),
      );
    },
  ],
  play: async () => {
    await holdToRun(userEvent.setup(), button("Point camera at track"));

    await expect(await screen.findByText("task is already being executed")).toBeInTheDocument();
    await expect(worldClient.runTask).toHaveBeenCalledWith({ entityId: "task-1" });
  },
};

export const RunInvalid: Story = {
  beforeEach: [
    twoTaskables,
    () => selected("cam-1"),
    () => {
      mocked(worldClient.runTask).mockResolvedValue(
        create(RunTaskResponseSchema, {
          status: TaskStatus.TaskStatusInvalid,
          humanReadableReason: "Stream has no source",
        }),
      );
    },
  ],
  play: async () => {
    await holdToRun(userEvent.setup(), button("Restart stream"));

    await expect(await screen.findByText("Stream has no source")).toBeInTheDocument();
  },
};

export const ReleaseAfterHoldFromRestKeepsRun: Story = {
  beforeEach: [twoTaskables, () => selected("cam-1"), acceptRuns],
  play: async () => {
    const user = userEvent.setup();
    const restart = button("Restart stream");

    await user.pointer({ keys: "[MouseLeft>]", target: restart });
    await waitFor(() => expect(worldClient.runTask).toHaveBeenCalledOnce(), { timeout: 2_000 });
    reportRestart(TaskExecutionState.TaskExecutionStatePending);
    await waitFor(() => expect(restart).toHaveTextContent(RUN_TEXT.cancel));
    await user.pointer({ keys: "[/MouseLeft]", target: restart });

    await nextFrame();
    await expect(restart).not.toHaveTextContent("Cancelling");
  },
};

export const RemovedRunStopsAwaiting: Story = {
  beforeEach: [
    twoTaskables,
    () => selected("cam-1"),
    () => {
      mocked(worldClient.runTask).mockResolvedValue(
        create(RunTaskResponseSchema, {
          executionId: "run-7",
          status: TaskStatus.TaskStatusRunning,
        }),
      );
    },
  ],
  play: async () => {
    await holdToRun(userEvent.setup(), button("Restart stream"));
    seedEntities([
      camera,
      pointCamera,
      restartStream(),
      entity("run-7", {
        taskExecution: { task: "task-2", state: TaskExecutionState.TaskExecutionStatePending },
      }),
    ]);
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RUN_TEXT.cancel));

    seedEntities([camera, pointCamera, restartStream()]);
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));
  },
};

export const RunReportsOutcome: Story = {
  beforeEach: [
    twoTaskables,
    () => selected("cam-1"),
    acceptRuns,
    () => holdTimeouts(DONE_SHOWN_MS),
  ],
  play: async () => {
    const user = userEvent.setup();

    await holdToRun(user, button("Restart stream"));
    reportRestart(TaskExecutionState.TaskExecutionStateCompleted, "Stream back online");
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent("Done."));
    elapseHeldTimeouts();
    await waitFor(() => expect(button("Restart stream")).toHaveTextContent(RESTART_EFFECT));

    mocked(worldClient.runTask).mockClear();
    await holdToRun(user, button("Restart stream"));
    reportRestart(TaskExecutionState.TaskExecutionStateFailed, "Stream source offline");

    const toasts = await exactToasts(2);

    await expect(toasts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Restart stream.*Stream back online/),
        expect.stringContaining("Stream source offline"),
      ]),
    );
  },
};

export const NothingSelected: Story = {
  beforeEach: () => seedEntities([hostile, camera]),
  play: async ({ canvas }) => {
    await expect(canvas.queryByLabelText("Follow entity")).toBeNull();
    await expect(canvas.queryByLabelText("Configure device")).toBeNull();
  },
};
