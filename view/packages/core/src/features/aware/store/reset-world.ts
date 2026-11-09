import AsyncStorage from "@react-native-async-storage/async-storage";

import { worldClient } from "../../../lib/api/world-client";
import { useMissionHealthStore } from "../../mission-pack/mission-health-store";
import { STORAGE_KEY } from "../constants";
import { layoutResetRef } from "../hooks/layout-snapshot";
import { placementResetRef } from "../placement-context";
import { useBullseyeStore } from "./bullseye-store";
import { useChatStore } from "./chat-store";
import { useEditStore } from "./edit-store";
import { useEntityStore } from "./entity-store";
import { useMissionKitStore } from "./mission-kit-store";
import { usePathStore } from "./path-store";
import { useSelectionStore } from "./selection-store";

export async function resetWorld() {
  placementResetRef.current?.();
  await worldClient.hardReset({});

  useSelectionStore.getState().clearSelection();
  useBullseyeStore.getState().clear();
  usePathStore.getState().clear();
  useEditStore.getState().cancel();
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
