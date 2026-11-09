import { create } from "@bufbuild/protobuf";
import { ConfigurableComponentSchema } from "@projectqai/proto/world";
import { describe, expect, it, vi } from "vitest";

import { answersPush } from "./use-config-handshake";

vi.mock("../../../lib/sonner", () => ({ toast: {} }));

const PUSHED = 4n;

function stamped(appliedVersion: bigint) {
  return create(ConfigurableComponentSchema, { appliedVersion });
}

describe("answersPush", () => {
  it("waits while the applied version is older than the pushed one", () => {
    expect(answersPush(stamped(3n), PUSHED)).toBe(false);
  });

  it("answers once the pushed version is applied, whatever state comes with it", () => {
    expect(answersPush(stamped(PUSHED), PUSHED)).toBe(true);
  });

  it("answers when a newer version was applied over the pushed one", () => {
    expect(answersPush(stamped(5n), PUSHED)).toBe(true);
  });
});
