import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { ChatComponentSchema, EntitySchema, LifetimeSchema } from "@projectqai/proto/world";
import { useState } from "react";

import { worldClient } from "./world-client";

let cachedNodeId: string | null = null;
let cachedSelfEntityId: string | null = null;
let cachedSelfLabel: string | null = null;
let inflightRequest: Promise<{ nodeId: string; entityId: string }> | null = null;
let lastNanos = 0n;

function nextId(nodeId: string): string {
  let nanos = BigInt(Date.now()) * 1_000_000n;
  if (nanos <= lastNanos) nanos = lastNanos + 1n;
  lastNanos = nanos;
  return `hydris.chat.${nodeId}.${nanos}`;
}

export async function ensureLocalNode() {
  if (cachedNodeId && cachedSelfEntityId) {
    return { nodeId: cachedNodeId, entityId: cachedSelfEntityId };
  }

  if (inflightRequest) return inflightRequest;

  inflightRequest = worldClient
    .getLocalNode({})
    .then((response) => {
      cachedNodeId = response.nodeId;
      cachedSelfEntityId = response.entity?.id ?? response.nodeId;
      cachedSelfLabel = response.entity?.label ?? null;
      inflightRequest = null;
      return { nodeId: cachedNodeId, entityId: cachedSelfEntityId };
    })
    .catch((err) => {
      inflightRequest = null;
      throw err;
    });

  return inflightRequest;
}

export function getSelfEntityId(): string | null {
  return cachedSelfEntityId;
}

export function isSelfMessage(senderId: string, entityId: string): boolean {
  if (!cachedSelfEntityId || !cachedNodeId) return false;
  if (senderId !== cachedSelfEntityId) return false;
  return entityId.startsWith(`hydris.chat.${cachedNodeId}.`);
}

export function getSelfLabel(): string | null {
  return cachedSelfLabel;
}

async function pushChatEntity(
  message: string,
  opts?: { recipientId?: string; replyTo?: string; reaction?: boolean },
) {
  const { nodeId } = await ensureLocalNode();
  const id = nextId(nodeId);

  const entity = create(EntitySchema, {
    id,
    chat: create(ChatComponentSchema, {
      sender: cachedSelfEntityId ?? nodeId,
      to: opts?.recipientId,
      message,
      replyTo: opts?.replyTo,
      reaction: opts?.reaction,
    }),
    lifetime: create(LifetimeSchema, { from: timestampNow() }),
  });

  const response = await worldClient.push({ changes: [entity] });
  if (!response.accepted) {
    throw new Error(response.debug || "Server rejected chat message");
  }
}

export function useSendChat() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = async (text: string, recipientId?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsPending(true);
    setError(null);

    try {
      await pushChatEntity(trimmed, { recipientId });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
    setIsPending(false);
  };

  const sendReply = async (text: string, replyToId: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsPending(true);
    setError(null);

    try {
      await pushChatEntity(trimmed, { replyTo: replyToId });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
    setIsPending(false);
  };

  return { sendMessage, sendReply, isPending, error };
}
