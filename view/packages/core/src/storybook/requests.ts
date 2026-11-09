import { create } from "@bufbuild/protobuf";
import {
  EntityChangeResponseSchema,
  RunTaskResponseSchema,
  TaskStatus,
} from "@projectqai/proto/world";
import { mocked } from "storybook/test";

import { worldClient } from "../lib/api/world-client";
import { downloadFromEndpoint } from "../lib/download";

export function acceptPushes() {
  mocked(worldClient.push).mockResolvedValue(
    create(EntityChangeResponseSchema, { accepted: true }),
  );
}

export function acceptRuns() {
  mocked(worldClient.runTask).mockImplementation(async ({ entityId }) =>
    create(RunTaskResponseSchema, { executionId: entityId, status: TaskStatus.TaskStatusRunning }),
  );
}

// The story answers the latest request itself, so it can act while the request is on its way
export function answerRunLater(executionId: string) {
  let answer = () => {};
  let fail = () => {};

  mocked(worldClient.runTask).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        answer = () =>
          resolve(
            create(RunTaskResponseSchema, { executionId, status: TaskStatus.TaskStatusRunning }),
          );

        fail = () => reject(new Error("Engine unreachable"));
      }),
  );

  return { answer: () => answer(), fail: () => fail() };
}

export function downloadNeverFinishes() {
  mocked(downloadFromEndpoint).mockReturnValue(new Promise(() => {}));
}
