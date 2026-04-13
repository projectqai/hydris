import type { Entity } from "@projectqai/proto/world";
import { EntityChange, EntityComponent } from "@projectqai/proto/world";
import { create } from "zustand";

import { ensureLocalNode } from "../../../lib/api/use-chat";
import { worldClient } from "../../../lib/api/world-client";
import { createBackoff } from "../../../lib/backoff";
import type { ChatMessage } from "./process-chat";
import { entityToChatMessage } from "./process-chat";

export type { ChatMessage } from "./process-chat";

const CHAT_STREAM_FILTER = {
  or: [{ component: [EntityComponent.EntityComponentChat] }],
};

const BATCH_INTERVAL_MS = 250;

export type InputSlot = { pageX: number; pageY: number; width: number; height: number } | null;

type ChatState = {
  messages: Map<string, ChatMessage>;
  sortedMessages: ChatMessage[];
  unreadCount: number;
  lastSeenTimestamp: number;
  replyTo: ChatMessage | null;
  inputSlot: InputSlot;
};

type ChatActions = {
  startStream: () => void;
  stopStream: () => void;
  markRead: () => void;
  reset: () => void;
  setReplyTo: (msg: ChatMessage | null) => void;
  setInputSlot: (slot: InputSlot) => void;
  registerPinToBottom: (fn: (() => void) | null) => void;
  pinToBottom: () => void;
};

let pinToBottomFn: (() => void) | null = null;
let abortController: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

function sortByTimestamp(a: ChatMessage, b: ChatMessage): number {
  return a.timestamp - b.timestamp;
}

function deriveState(messages: Map<string, ChatMessage>) {
  const sorted: ChatMessage[] = [];

  for (const msg of messages.values()) {
    if (!msg.isReaction) sorted.push(msg);
  }

  sorted.sort(sortByTimestamp);
  return { sortedMessages: sorted };
}

export const useChatStore = create<ChatState & ChatActions>()((set) => ({
  messages: new Map(),
  sortedMessages: [],
  unreadCount: 0,
  lastSeenTimestamp: 0,
  replyTo: null,
  inputSlot: null,

  setReplyTo: (msg) => set({ replyTo: msg }),
  setInputSlot: (slot) => set({ inputSlot: slot }),

  registerPinToBottom: (fn) => {
    pinToBottomFn = fn;
  },

  pinToBottom: () => {
    pinToBottomFn?.();
  },

  startStream: () => {
    if (abortController) return;

    abortController = new AbortController();

    const backoff = createBackoff(250, 5000);
    const pendingUpdates = new Map<string, Entity>();
    let flushScheduled = false;

    const flushUpdates = () => {
      flushScheduled = false;
      if (pendingUpdates.size === 0) return;

      const batch = new Map(pendingUpdates);
      pendingUpdates.clear();

      set((state) => {
        const messages = new Map(state.messages);
        let newCount = 0;
        for (const [id, entity] of batch) {
          const msg = entityToChatMessage(entity);
          if (!msg) continue;
          if (!messages.has(id) && !msg.isReaction && msg.timestamp > state.lastSeenTimestamp) {
            newCount++;
          }
          messages.set(id, msg);
        }

        return {
          messages,
          ...deriveState(messages),
          unreadCount: state.unreadCount + newCount,
        };
      });
    };

    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      flushTimeout = setTimeout(flushUpdates, BATCH_INTERVAL_MS);
    };

    function handleStreamError() {
      const signal = abortController?.signal;
      if (signal?.aborted) return;

      const delay = backoff.next();
      reconnectTimeout = setTimeout(() => {
        if (signal?.aborted) return;

        pendingUpdates.clear();
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        flushScheduled = false;

        stream();
      }, delay);
    }

    async function stream() {
      if (!abortController) return;
      const signal = abortController.signal;

      try {
        await ensureLocalNode();

        const { entities: initial } = await worldClient.listEntities(
          { filter: CHAT_STREAM_FILTER },
          { signal },
        );
        if (signal.aborted) return;

        if (initial.length > 0) {
          set((state) => {
            const messages = new Map(state.messages);
            for (const entity of initial) {
              const msg = entityToChatMessage(entity);
              if (msg) messages.set(entity.id, msg);
            }

            return { messages, ...deriveState(messages) };
          });
        }
        backoff.reset();

        for await (const event of worldClient.watchEntities(
          { filter: CHAT_STREAM_FILTER, behaviour: { maxRateHz: 10000 } },
          { signal },
        )) {
          if (signal.aborted) break;

          const { entity, t } = event;
          if (!entity?.id) continue;

          if (t === EntityChange.EntityChangeUpdated) {
            pendingUpdates.set(entity.id, entity);
            scheduleFlush();
          }
        }
      } catch {
        handleStreamError();
      }
    }

    stream();
  },

  stopStream: () => {
    abortController?.abort();
    abortController = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
  },

  markRead: () => {
    set({ unreadCount: 0, lastSeenTimestamp: Date.now() });
  },

  reset: () => {
    abortController?.abort();
    abortController = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    set({
      messages: new Map(),
      sortedMessages: [],
      unreadCount: 0,
      lastSeenTimestamp: 0,
    });
  },
}));
