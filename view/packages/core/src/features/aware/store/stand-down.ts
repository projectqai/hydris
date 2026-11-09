import { useBullseyeStore } from "./bullseye-store";
import { useEditStore } from "./edit-store";
import { usePathStore } from "./path-store";

// An armed range keeps taking map clicks even once its bar is hidden.
export function standDownModes(): void {
  useEditStore.getState().cancel();
  usePathStore.getState().cancel();
  useBullseyeStore.getState().clear();
}
