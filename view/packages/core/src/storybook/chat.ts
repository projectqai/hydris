import type { ChatMessage } from "../features/aware/store/process-chat";
import { STORY_SELF_ID } from "../lib/api/__mocks__/use-chat";
import { STORY_NOW } from "./clock";

export { STORY_SELF_ID };

export function chatMessage(
  id: string,
  senderId: string,
  text: string,
  secondsAgo: number,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id,
    senderId,
    senderName: senderId,
    text,
    timestamp: STORY_NOW - secondsAgo * 1000,
    ...extra,
  };
}
