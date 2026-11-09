import { clearSavedHighlights } from "@hydris/ui/command-palette/use-list-nav";
import type { Entity } from "@projectqai/proto/world";
import type { StoreApi } from "zustand";

import { useBullseyeStore } from "../features/aware/store/bullseye-store";
import type { ChatMessage } from "../features/aware/store/chat-store";
import { useChatStore } from "../features/aware/store/chat-store";
import { useEditStore } from "../features/aware/store/edit-store";
import { useEntityStore } from "../features/aware/store/entity-store";
import { useLeftPanelStore } from "../features/aware/store/left-panel-store";
import { useMapEngineStore } from "../features/aware/store/map-engine-store";
import { useMapStore } from "../features/aware/store/map-store";
import { useMissionKitStore } from "../features/aware/store/mission-kit-store";
import { useOverlayStore } from "../features/aware/store/overlay-store";
import { usePathStore } from "../features/aware/store/path-store";
import { useSelectionStore } from "../features/aware/store/selection-store";
import { useTabStore } from "../features/aware/store/tab-store";
import { useMissionHealthStore } from "../features/mission-pack/mission-health-store";
import type { AlarmState } from "../features/sensors/alarm-store";
import { useAlarmStore } from "../features/sensors/alarm-store";
import { isDetectionEntity } from "../lib/api/use-track-utils";
import { entityMap } from "./entities";

export function seed<T>(store: StoreApi<T>, state: Partial<T>) {
  store.setState(state);
}

type EntityStoreState = ReturnType<typeof useEntityStore.getState>;

export function seedEntities(entities: Entity[], state?: Partial<EntityStoreState>) {
  seed(useEntityStore, {
    entities: entityMap(entities),
    detectionEntityIds: new Set(entities.filter(isDetectionEntity).map((entity) => entity.id)),
    ...state,
  });
  useEntityStore.getState().resortEntities();
}

type ChatStoreState = ReturnType<typeof useChatStore.getState>;

export function seedChat(messages: ChatMessage[], state?: Partial<ChatStoreState>) {
  seed(useChatStore, {
    messages: new Map(messages.map((message) => [message.id, message])),
    sortedMessages: messages
      .filter((message) => !message.isReaction)
      .sort((a, b) => a.timestamp - b.timestamp),
    ...state,
  });
}

export function seedAlarms(alarms: AlarmState[]) {
  seed(useAlarmStore, {
    activeAlarms: new Map(alarms.map((alarm) => [alarm.sensorId, alarm])),
  });
}

function reset<T>(store: StoreApi<T>) {
  store.setState(store.getInitialState(), true);
}

export function resetStores() {
  reset(useAlarmStore);
  reset(useBullseyeStore);
  reset(useChatStore);
  reset(useEditStore);
  reset(useEntityStore);
  reset(useLeftPanelStore);
  reset(useMapEngineStore);
  reset(useMapStore);
  reset(useMissionHealthStore);
  // its reset action also clears module state
  useMissionKitStore.getState().reset();
  reset(useOverlayStore);
  reset(usePathStore);
  reset(useSelectionStore);
  reset(useTabStore);
  clearSavedHighlights();
}
