import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { holdToConfirmEnabled } from "@hydris/ui/hooks/hold-to-confirm-flag";
import { CONFIRM_LAPSE_MS } from "@hydris/ui/hooks/use-confirm-press";
import { LANDED_SHOWN_MS } from "@hydris/ui/picker";
import { center, tap } from "@hydris/ui/storybook/pointer";
import { IGNORE_HIDDEN } from "@hydris/ui/storybook/queries";
import { TaskExecutionTargetSchema } from "@projectqai/proto/tasking";
import type { Entity } from "@projectqai/proto/world";
import { CancelTaskResponseSchema, TaskExecutionState } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, mocked, screen, userEvent, waitFor } from "storybook/test";

import { worldClient } from "../../../../lib/api/world-client";
import {
  ago,
  ahead,
  elapseHeldTimeouts,
  holdTimeouts,
  nextFrame,
} from "../../../../storybook/clock";
import type { EntityInit } from "../../../../storybook/entities";
import { entity } from "../../../../storybook/entities";
import { coreProviders } from "../../../../storybook/providers";
import { answerRunLater } from "../../../../storybook/requests";
import { seedEntities } from "../../../../storybook/seed";
import { useEntityStore } from "../../store/entity-store";
import { RUN_TEXT } from "../../utils/task-feedback";
import { ModePicker } from "./mode-picker";

function LiveModePicker({ taskable }: { taskable: Entity }) {
  const live = useEntityStore((state) => state.entities.get(taskable.id));

  return <ModePicker taskable={live ?? taskable} />;
}

const device = entity("device-7", { label: "Device 7" });

const OPTIONS = [
  { id: "standby", label: "Standby", description: "Sensors parked, lowest draw" },
  { id: "survey", label: "Survey", description: "Wide scan at routine rate" },
  { id: "boost", label: "Boost", description: "Full rate for a short time" },
  {
    id: "track",
    label: "Track",
    description: "Follows one target",
    disabled: "No target assigned",
  },
];

type ModeInit = {
  active?: string;
  secondsLeft?: number;
  next?: string;
  unavailable?: string;
  locked?: string;
};

function modeTaskable(mode: ModeInit, init: EntityInit = {}) {
  return entity("mode-7", {
    taskable: {
      label: "Operating mode",
      disabled: mode.unavailable,
      assignee: [{ entityId: device.id }],
      target: {
        mode: {
          options: OPTIONS.map((option) => ({
            ...option,
            disabled: mode.locked ?? option.disabled,
          })),
          active: mode.active,
          until: mode.secondsLeft === undefined ? undefined : ahead(mode.secondsLeft),
          next: mode.next,
        },
      },
    },
    ...init,
  });
}

type Report = { reason?: string; eta?: Timestamp; progress?: number };

function switchingTo(option: string, state: TaskExecutionState, report: Report): EntityInit {
  return {
    lifetime: { fresh: ago(60) },
    taskExecution: {
      task: "mode-7",
      state,
      target: { kind: { case: "mode", value: option } },
      ...report,
    },
  };
}

const meta = {
  title: "Core/Aware/Mode picker/ModePicker",
  component: ModePicker,
  argTypes: { taskable: { control: false } },
  tags: ["!autodocs"],
  args: { taskable: modeTaskable({ active: "boost", secondsLeft: 4 * 60, next: "survey" }) },
  beforeEach: ({ args }) => seedEntities([device, args.taskable]),
  decorators: [
    (Story) => (
      <View className="w-64">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
} satisfies Meta<typeof ModePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const boost = canvas.getByRole("radio", { name: /Boost/ });
    await expect(boost).toHaveAttribute("aria-checked", "true");
    await expect(boost).toHaveTextContent("→ Survey");

    await userEvent.click(boost);

    const track = await canvas.findByRole("radio", { name: /Track/ });
    await expect(track).toHaveAttribute("aria-disabled", "true");
    await expect(track).not.toHaveTextContent("No target assigned");
  },
};

export const RefusedShowsWhyUntilNextPress: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("radio", { name: /Boost/ }));

    const track = await canvas.findByRole("radio", { name: /Track/ });
    await waitFor(() => expect(track).toBeVisible());
    await tap(center(track));

    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("No target assigned");
    await expect(track).toContainElement(alert);
    await expect(worldClient.runTask).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole("radio", { name: /Standby/ }));
    await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
  },
};

export const UnlistedActive: Story = {
  args: { taskable: modeTaskable({ active: "failsafe-2" }) },
  play: async ({ canvas }) => {
    const failsafe = canvas.getByRole("radio", { name: "failsafe-2" });
    await expect(failsafe).toHaveAttribute("aria-checked", "true");

    await userEvent.click(failsafe);
    const standby = await canvas.findByRole("radio", { name: /Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
  },
};

export const Unknown: Story = {
  args: { taskable: modeTaskable({}) },
  play: async ({ canvas }) => {
    for (const name of [/Standby/, /Survey/, /Boost/, /Track/]) {
      await expect(canvas.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false");
    }
  },
};

export const Unavailable: Story = {
  args: { taskable: modeTaskable({ active: "survey", unavailable: "Device is restarting" }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Device is restarting")).toBeVisible();
    await expect(canvas.getByRole("radio", { name: /Survey/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

const parkingToStandby = modeTaskable(
  { active: "survey" },
  switchingTo("standby", TaskExecutionState.TaskExecutionStateRunning, {
    reason: "Parking sensors",
    eta: ahead(90),
    progress: 40,
  }),
);

export const Running: Story = {
  args: { taskable: parkingToStandby },
  play: async ({ canvas }) => {
    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await expect(canvas.queryByRole("radio", { name: /^Survey/ })).toBeNull();
    await expect(standby).toHaveTextContent("Parking sensors");
    await expect(standby).not.toHaveTextContent(RUN_TEXT.cancel);
    await expect(canvas.getByRole("progressbar", { name: "Standby progress" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );

    await userEvent.click(document.body);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(standby).toBeVisible();

    await userEvent.click(standby);
    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "mode-7" });
  },
};

const waitingForStandby = modeTaskable(
  { active: "survey" },
  switchingTo("standby", TaskExecutionState.TaskExecutionStatePending, {}),
);

export const CancelRefused: Story = {
  args: { taskable: waitingForStandby },
  play: async ({ canvas }) => {
    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await userEvent.click(standby);

    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "mode-7" });
    await expect(
      await screen.findByText("worldClient.cancelTask called from a story"),
    ).toBeInTheDocument();
    await waitFor(() => expect(standby).toHaveTextContent(RUN_TEXT.cancel));
  },
};

export const CancelShowsUntilRunEnds: Story = {
  args: { taskable: waitingForStandby },
  beforeEach: () => {
    mocked(worldClient.cancelTask).mockResolvedValue(create(CancelTaskResponseSchema, {}));
  },
  play: async ({ canvas }) => {
    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await userEvent.click(standby);

    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "mode-7" });
    await nextFrame();
    await expect(standby).toHaveTextContent(RUN_TEXT.cancelling);
  },
};

export const PendingFoldsToTarget: Story = {
  args: {
    taskable: modeTaskable(
      { active: "survey" },
      switchingTo("standby", TaskExecutionState.TaskExecutionStatePending, {}),
    ),
  },
  play: async ({ canvas }) => {
    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await expect(canvas.queryByRole("radio", { name: /^Boost/ })).toBeNull();
  },
};

export const Failed: Story = {
  args: {
    taskable: modeTaskable(
      { active: "survey" },
      switchingTo("standby", TaskExecutionState.TaskExecutionStateFailed, {
        reason: "Sensor mount stuck",
      }),
    ),
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Sensor mount stuck");

    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await expect(standby).toHaveTextContent("Sensor mount stuck");
    await expect(canvas.queryByRole("radio", { name: /^Survey/ })).toBeNull();
  },
};

export const FailsafeOutranksFailure: Story = {
  args: {
    taskable: modeTaskable(
      { active: "failsafe", locked: "Sensor is in failsafe" },
      switchingTo("standby", TaskExecutionState.TaskExecutionStateFailed, {
        reason: "Sensor mount stuck",
      }),
    ),
  },
  play: async ({ canvas }) => {
    const failsafe = await canvas.findByRole("radio", { name: /^failsafe/ });
    await waitFor(() => expect(failsafe).toBeVisible());
    await expect(canvas.queryByRole("radio", { name: /^Standby/ })).toBeNull();

    await userEvent.click(failsafe);

    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await expect(standby).toHaveTextContent("Sensor mount stuck");

    await tap(center(standby));
    await expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "mode-7" });
  },
};

export const FailedDismissed: Story = {
  args: Failed.args,
  play: async ({ canvas }) => {
    const user = userEvent.setup();
    const standby = await canvas.findByRole("radio", { name: /^Standby/ });

    await waitFor(() => expect(standby).toBeVisible());
    await user.click(standby);
    await expect(
      await screen.findByText("worldClient.cancelTask called from a story"),
    ).toBeInTheDocument();
    await nextFrame();
    await expect(standby).toHaveTextContent("Sensor mount stuck");

    mocked(worldClient.cancelTask).mockResolvedValue(create(CancelTaskResponseSchema, {}));
    await user.click(standby);

    await expect(worldClient.cancelTask).toHaveBeenCalledTimes(2);
    await expect(worldClient.cancelTask).toHaveBeenLastCalledWith({ executionId: "mode-7" });
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /^Standby/ })).toBeNull());

    await user.click(canvas.getByRole("radio", { name: /^Survey/ }));

    const reopened = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(reopened).toBeVisible());
    await expect(reopened).not.toHaveTextContent("Sensor mount stuck");

    await user.click(reopened);
    await expect(await canvas.findByText("Hold to confirm", IGNORE_HIDDEN)).toBeInTheDocument();
    await expect(worldClient.runTask).not.toHaveBeenCalled();
  },
};

export const TapLapsesWithoutHold: Story = {
  args: { taskable: modeTaskable({ active: "survey" }) },
  beforeEach: () => holdTimeouts(CONFIRM_LAPSE_MS),
  play: async ({ canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(canvas.getByRole("radio", { name: /^Survey/ }));

    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await user.click(standby);
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    elapseHeldTimeouts();

    await waitFor(() => expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull());
    await expect(standby).toBeVisible();
    await expect(worldClient.runTask).not.toHaveBeenCalled();
  },
};

function standbyDone(active: string) {
  return modeTaskable(
    { active },
    switchingTo("standby", TaskExecutionState.TaskExecutionStateCompleted, {
      reason: "Sensors parked",
    }),
  );
}

export const LandsQuietlyThenFolds: Story = {
  args: { taskable: modeTaskable({ active: "survey" }) },
  render: (args) => <LiveModePicker {...args} />,
  beforeEach: () => holdTimeouts(LANDED_SHOWN_MS),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("radio", { name: /^Survey/ }));

    const boost = await canvas.findByRole("radio", { name: /Boost/ });
    await waitFor(() => expect(boost).toBeVisible());

    seedEntities([device, parkingToStandby]);
    await waitFor(() => expect(canvas.getByRole("radio", { name: /^Standby/ })).toBeVisible());
    seedEntities([device, standbyDone("standby")]);

    const standby = canvas.getByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toHaveAttribute("aria-checked", "true"));
    await expect(standby).not.toHaveTextContent("Done");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(canvas.getByRole("radio", { name: /Boost/ })).toBeVisible();

    elapseHeldTimeouts();
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /Boost/ })).toBeNull());
  },
};

export const DoneBeforeOpening: Story = {
  args: { taskable: standbyDone("standby") },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("radio", { name: /Standby/ })).toBeVisible();
    await expect(canvas.queryByText(/Done/)).toBeNull();
  },
};

export const ReleaseAfterHoldFromRestKeepsSwitch: Story = {
  args: { taskable: modeTaskable({ active: "survey" }) },
  render: (args) => <LiveModePicker {...args} />,
  play: async ({ canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(canvas.getByRole("radio", { name: /^Survey/ }));

    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());

    await user.pointer({ keys: "[MouseLeft>]", target: standby });
    await waitFor(() => expect(worldClient.runTask).toHaveBeenCalledOnce(), { timeout: 2_000 });
    seedEntities([device, waitingForStandby]);
    await waitFor(() => expect(standby).toHaveTextContent(RUN_TEXT.cancel));
    await user.pointer({ keys: "[/MouseLeft]", target: standby });

    await nextFrame();
    await expect(standby).not.toHaveTextContent("Cancelling");
  },
};

export const CancelWhileSwitchRequested: Story = {
  args: { taskable: modeTaskable({ active: "survey" }) },
  render: (args) => <LiveModePicker {...args} />,
  beforeEach: () => {
    mocked(worldClient.cancelTask).mockResolvedValue(create(CancelTaskResponseSchema, {}));
  },
  play: async ({ canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { answer } = answerRunLater("mode-7");

    await user.click(canvas.getByRole("radio", { name: /^Survey/ }));

    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());

    await user.pointer({ keys: "[MouseLeft>]", target: standby });
    await waitFor(() => expect(worldClient.runTask).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await user.pointer({ keys: "[/MouseLeft]", target: standby });
    await waitFor(() => expect(standby).toHaveTextContent(RUN_TEXT.cancel));

    await user.click(standby);
    await waitFor(() => expect(standby).toHaveTextContent(RUN_TEXT.cancelling));
    await expect(worldClient.cancelTask).not.toHaveBeenCalled();

    answer();
    await waitFor(() =>
      expect(worldClient.cancelTask).toHaveBeenCalledWith({ executionId: "mode-7" }),
    );
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /^Standby/ })).toBeNull());
    await expect(canvas.getByRole("radio", { name: /^Survey/ })).toBeVisible();
  },
};

export const TapSwitchesWithoutHold: Story = {
  args: { taskable: modeTaskable({ active: "survey" }) },
  beforeEach: () => {
    mocked(holdToConfirmEnabled).mockReturnValue(false);
  },
  play: async ({ canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(canvas.getByRole("radio", { name: /^Survey/ }));

    const standby = await canvas.findByRole("radio", { name: /^Standby/ });
    await waitFor(() => expect(standby).toBeVisible());
    await user.click(standby);

    await expect(worldClient.runTask).toHaveBeenCalledOnce();
    await expect(worldClient.runTask).toHaveBeenCalledWith({
      entityId: "mode-7",
      target: create(TaskExecutionTargetSchema, { kind: { case: "mode", value: "standby" } }),
    });
    await expect(canvas.queryByText("Hold to confirm", IGNORE_HIDDEN)).toBeNull();
  },
};

export const HoldRequestsSwitchAndFolds: Story = {
  args: { taskable: modeTaskable({ active: "survey" }) },
  play: async ({ canvas }) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(canvas.getByRole("radio", { name: /Survey/ }));
    await user.click(await canvas.findByRole("radio", { name: /Standby/ }));
    await canvas.findByText("Hold to confirm", IGNORE_HIDDEN);

    const standby = canvas.getByRole("radio", { name: /Standby/ });
    await user.pointer({ keys: "[MouseLeft>]", target: standby });
    await waitFor(() => expect(worldClient.runTask).toHaveBeenCalledOnce(), { timeout: 2_000 });
    await user.pointer({ keys: "[/MouseLeft]", target: standby });

    await expect(worldClient.runTask).toHaveBeenCalledWith({
      entityId: "mode-7",
      target: create(TaskExecutionTargetSchema, { kind: { case: "mode", value: "standby" } }),
    });
    await waitFor(() => expect(canvas.queryByRole("radio", { name: /Boost/ })).toBeNull());
  },
};
