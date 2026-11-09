import { Platform } from "react-native";

export const DONE_SHOWN_MS = 1500;

export const RUN_TEXT = {
  cancel: Platform.select({ android: "Tap to cancel", default: "Click to cancel" }),
  cancelling: "Cancelling",
  done: "Done.",
};
