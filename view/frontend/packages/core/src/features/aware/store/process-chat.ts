import type { Entity } from "@projectqai/proto/world";

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  recipientId?: string;
  text: string;
  timestamp: number;
  replyTo?: string;
  isReaction?: boolean;
};

export function entityToChatMessage(entity: Entity): ChatMessage | null {
  if (!entity.chat?.message) return null;

  if (!entity.lifetime?.from) return null;
  const ts = entity.lifetime.from;
  const timestamp = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);

  const senderId = entity.chat.sender ?? "";

  return {
    id: entity.id,
    senderId,
    senderName: entity.label || senderId,
    recipientId: entity.chat.to || undefined,
    text: entity.chat.message,
    timestamp,
    replyTo: entity.chat.replyTo || undefined,
    isReaction: entity.chat.reaction || undefined,
  };
}
