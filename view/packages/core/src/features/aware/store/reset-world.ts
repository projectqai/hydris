import AsyncStorage from "@react-native-async-storage/async-storage";

import { worldClient } from "../../../lib/api/world-client";
import { useMissionHealthStore } from "../../mission-pack/mission-health-store";
import { STORAGE_KEY } from "../constants";
import { layoutResetRef } from "../hooks/layout-snapshot";
import { useChatStore } from "./chat-store";
import { useEntityStore } from "./entity-store";
import { useMissionKitStore } from "./mission-kit-store";
import { useRangeRingStore } from "./range-ring-store";
import { useSelectionStore } from "./selection-store";

export async function resetWorld() {
  await worldClient.hardReset({});

  useSelectionStore.getState().clearSelection();
  useRangeRingStore.getState().clear();
  useMissionKitStore.getState().reset();
  useMissionHealthStore.getState().clear();
  layoutResetRef.current?.();
  AsyncStorage.removeItem(STORAGE_KEY);

  useEntityStore.getState().reset();
  useChatStore.getState().reset();

  useEntityStore.getState().startStream();
  useChatStore.getState().startStream();

  useMissionKitStore.getState().fetch();
}
