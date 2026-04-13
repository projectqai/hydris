import type { Entity } from "@projectqai/proto/world";
import { describe, expect, it } from "vitest";

import { entityToChatMessage } from "./process-chat";

const DEFAULT_LIFETIME = { from: { seconds: 1700000000n, nanos: 0 } };

function entity(
  id: string,
  chat?: {
    sender?: string;
    to?: string;
    message?: string;
    replyTo?: string;
    reaction?: boolean;
  },
  opts?: {
    lifetime?: { from?: { seconds: bigint; nanos: number } } | null;
    label?: string;
  },
): Entity {
  return {
    id,
    chat,
    label: opts?.label,
    lifetime: opts?.lifetime === null ? undefined : (opts?.lifetime ?? DEFAULT_LIFETIME),
  } as Entity;
}

describe("entityToChatMessage", () => {
  it("returns null when chat component is missing", () => {
    expect(entityToChatMessage({ id: "e1" } as Entity)).toBeNull();
  });

  it("returns null when message is empty", () => {
    expect(entityToChatMessage(entity("e1", { message: "" }))).toBeNull();
  });

  it("returns null when lifetime.from is missing", () => {
    expect(entityToChatMessage(entity("e1", { message: "hi" }, { lifetime: null }))).toBeNull();
  });

  it("maps entity id", () => {
    const result = entityToChatMessage(entity("e1", { message: "hi" }));
    expect(result?.id).toBe("e1");
  });

  it("maps sender to senderId and falls back to senderId for senderName", () => {
    const result = entityToChatMessage(entity("e1", { sender: "node-7", message: "hi" }));
    expect(result?.senderId).toBe("node-7");
    expect(result?.senderName).toBe("node-7");
  });

  it("prefers entity label for senderName", () => {
    const result = entityToChatMessage(
      entity("e1", { sender: "node-7", message: "hi" }, { label: "Alpha" }),
    );
    expect(result?.senderId).toBe("node-7");
    expect(result?.senderName).toBe("Alpha");
  });

  it("defaults sender to empty string when missing", () => {
    const result = entityToChatMessage(entity("e1", { message: "hi" }));
    expect(result?.senderId).toBe("");
  });

  it("maps to field as recipientId", () => {
    const result = entityToChatMessage(entity("e1", { to: "r1", message: "hi" }));
    expect(result?.recipientId).toBe("r1");
  });

  it("treats empty to as no recipient", () => {
    const result = entityToChatMessage(entity("e1", { to: "", message: "hi" }));
    expect(result?.recipientId).toBeUndefined();
  });

  it("parses timestamp from lifetime.from", () => {
    const result = entityToChatMessage(
      entity(
        "e1",
        { message: "hi" },
        {
          lifetime: { from: { seconds: 1700000000n, nanos: 500_000_000 } },
        },
      ),
    );
    expect(result?.timestamp).toBe(1700000000 * 1000 + 500);
  });

  it("maps replyTo field", () => {
    const result = entityToChatMessage(entity("e1", { message: "re", replyTo: "e0" }));
    expect(result?.replyTo).toBe("e0");
  });

  it("maps reaction flag", () => {
    const result = entityToChatMessage(
      entity("e1", { message: "👍", replyTo: "e0", reaction: true }),
    );
    expect(result?.isReaction).toBe(true);
    expect(result?.text).toBe("👍");
  });

  it("leaves isReaction undefined when not a reaction", () => {
    const result = entityToChatMessage(entity("e1", { message: "hi" }));
    expect(result?.isReaction).toBeUndefined();
  });
});
