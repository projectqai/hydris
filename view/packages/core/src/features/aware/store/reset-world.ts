import { worldClient } from "../../../lib/api/world-client";
import { useChatStore } from "./chat-store";
import { useEntityStore } from "./entity-store";
import { useRangeRingStore } from "./range-ring-store";
import { useSelectionStore } from "./selection-store";

export async function resetWorld() {
  await worldClient.hardReset({});

  useSelectionStore.getState().clearSelection();
  useRangeRingStore.getState().clear();

  useEntityStore.getState().reset();
  useChatStore.getState().reset();

  useEntityStore.getState().startStream();
  useChatStore.getState().startStream();
}
