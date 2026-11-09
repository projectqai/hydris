import { fn } from "storybook/test";

import type * as real from "../use-chat";

export const STORY_SELF_ID = "node-self";

type SendChat = ReturnType<typeof real.useSendChat>;

export const ensureLocalNode = fn<typeof real.ensureLocalNode>(async () => {
  throw new Error("ensureLocalNode called from a story");
}).mockName("ensureLocalNode");

export const isSelfMessage = fn<typeof real.isSelfMessage>(
  (senderId) => senderId === STORY_SELF_ID,
).mockName("isSelfMessage");

export const getSelfLabel = fn<typeof real.getSelfLabel>(() => null).mockName("getSelfLabel");

const sendMessage = fn<SendChat["sendMessage"]>(async () => {}).mockName("sendMessage");
const sendReply = fn<SendChat["sendReply"]>(async () => {}).mockName("sendReply");

export const useSendChat = fn<typeof real.useSendChat>(() => ({
  sendMessage,
  sendReply,
  isPending: false,
  error: null,
})).mockName("useSendChat");
