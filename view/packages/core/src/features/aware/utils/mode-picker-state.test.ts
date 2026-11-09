import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { TaskExecutionTarget } from "@projectqai/proto/tasking";
import { TaskExecutionState } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import type { EntityInit } from "../../../storybook/entities";
import { entity } from "../../../storybook/entities";
import { deriveModePicker } from "./mode-picker-state";

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

const OPTIONS = [
  { id: "standby", label: "Standby", description: "Sensors parked, lowest draw" },
  { id: "survey", label: "Survey", description: "Wide scan at routine rate" },
  { id: "boost", label: "Boost", description: "", disabled: "Battery below 30%" },
  { id: "service", label: "", disabled: "" },
];

type ModeInit = { active?: string; until?: number; next?: string };

function modeTaskable(mode: ModeInit, init: EntityInit = {}) {
  return entity("mode-7", {
    taskable: {
      label: "Operating mode",
      assignee: [{ entityId: "dev-7" }],
      target: {
        mode: {
          options: OPTIONS,
          active: mode.active,
          until: mode.until === undefined ? undefined : timestampFromMs(mode.until),
          next: mode.next,
        },
      },
    },
    ...init,
  });
}

function switchTo(option: string): TaskExecutionTarget["kind"] {
  return { case: "mode", value: option };
}

function reported(state: TaskExecutionState, option: string, freshMs: number, extra = {}) {
  return {
    lifetime: { fresh: timestampFromMs(freshMs) },
    taskExecution: { task: "mode-7", state, target: { kind: switchTo(option) }, ...extra },
  };
}

describe("deriveModePicker", () => {
  it("lists the offered options in the order sent, with their text as sent", () => {
    const picker = deriveModePicker(modeTaskable({ active: "survey" }));

    expect(picker.value).toBe("survey");
    expect(picker.pendingValue).toBeUndefined();

    expect(picker.rows).toEqual([
      {
        id: "standby",
        title: "Standby",
        description: "Sensors parked, lowest draw",
        disabled: false,
      },
      { id: "survey", title: "Survey", description: "Wide scan at routine rate", disabled: false },
      { id: "boost", title: "Boost", disabled: true, disabledReason: "Battery below 30%" },
      { id: "service", title: "service", disabled: true },
    ]);
  });

  it("has no current option while the device does not report one", () => {
    const picker = deriveModePicker(modeTaskable({}));

    expect(picker.value).toBeUndefined();
    expect(picker.rows.map((row) => row.id)).toEqual(["standby", "survey", "boost", "service"]);
  });

  it("lists an option the device entered on its own after the offered ones and never requests it", () => {
    const picker = deriveModePicker(modeTaskable({ active: "failsafe-2" }));

    expect(picker.value).toBe("failsafe-2");
    expect(picker.rows).toHaveLength(5);
    expect(picker.rows[4]).toEqual({ id: "failsafe-2", title: "failsafe-2", disabled: true });
  });

  it("marks when the option in effect ends on its own and which one follows", () => {
    const until = NOW + 4 * 60_000;
    const picker = deriveModePicker(modeTaskable({ active: "survey", until, next: "standby" }));

    expect(picker.rows.map((row) => row.expires)).toEqual([
      undefined,
      { at: timestampFromMs(until), next: "Standby" },
      undefined,
      undefined,
    ]);

    const unlisted = deriveModePicker(modeTaskable({ active: "survey", until, next: "cooldown" }));

    expect(unlisted.rows[1]?.expires?.next).toBe("cooldown");
  });

  it("follows the switch the controller is working on under the option it requested", () => {
    const report = { reason: "Parking sensors", eta: timestampFromMs(NOW + 90_000), progress: 40 };
    const picker = deriveModePicker(
      modeTaskable(
        { active: "survey" },
        reported(TaskExecutionState.TaskExecutionStateRunning, "standby", NOW - 60_000, report),
      ),
    );

    expect(picker.value).toBe("survey");
    expect(picker.pendingValue).toBe("standby");

    expect(picker.rows.map((row) => row.outcome)).toEqual([
      {
        state: TaskExecutionState.TaskExecutionStateRunning,
        target: "standby",
        progress: report.progress,
        reason: report.reason,
      },
      undefined,
      undefined,
      undefined,
    ]);

    const queued = deriveModePicker(
      modeTaskable(
        { active: "survey" },
        reported(TaskExecutionState.TaskExecutionStatePending, "standby", NOW - 60_000),
      ),
    );

    expect(queued.pendingValue).toBe("standby");
    expect(queued.rows[0]?.outcome?.state).toBe(TaskExecutionState.TaskExecutionStatePending);

    const unknown = deriveModePicker(
      modeTaskable(
        {},
        reported(TaskExecutionState.TaskExecutionStatePending, "standby", NOW - 60_000),
      ),
    );

    expect(unknown.rows[0]?.outcome?.target).toBe("standby");
  });

  it("points at the option whose request is still on its way", () => {
    expect(deriveModePicker(modeTaskable({ active: "survey" }), "standby").pendingValue).toBe(
      "standby",
    );

    const replacing = modeTaskable(
      { active: "survey" },
      reported(TaskExecutionState.TaskExecutionStateRunning, "standby", NOW - 60_000),
    );

    expect(deriveModePicker(replacing, "survey").pendingValue).toBe("survey");
  });

  it("shows nothing for a completed switch", () => {
    const completed = modeTaskable(
      { active: "standby" },
      reported(TaskExecutionState.TaskExecutionStateCompleted, "standby", NOW - 1_000, {
        reason: "Sensors parked",
      }),
    );

    const picker = deriveModePicker(completed);

    expect(picker.pendingValue).toBeUndefined();
    expect(picker.rows.every((row) => row.outcome === undefined)).toBe(true);
  });

  it("keeps a failed request under the option it requested until another request replaces it", () => {
    const failed = modeTaskable(
      { active: "survey" },
      reported(TaskExecutionState.TaskExecutionStateFailed, "standby", NOW - 3_600_000, {
        reason: "Sensor mount stuck",
      }),
    );

    const picker = deriveModePicker(failed);

    expect(picker.value).toBe("survey");
    expect(picker.pendingValue).toBeUndefined();

    expect(picker.rows.map((row) => row.outcome)).toEqual([
      {
        state: TaskExecutionState.TaskExecutionStateFailed,
        target: "standby",
        reason: "Sensor mount stuck",
      },
      undefined,
      undefined,
      undefined,
    ]);
  });
});
