import { createContext, useContext } from "react";

export type ShortcutHandler = () => boolean | void;

export type ShortcutRegistration = {
  id: string;
  key: string;
  handler: ShortcutHandler;
  priority: number;
  yieldToFocus?: boolean;
  layer?: string;
};

type KeyboardContextValue = {
  register: (shortcut: ShortcutRegistration) => () => void;
  addLayer: (layer: string) => () => void;
  layer?: string;
};

export const KeyboardContext = createContext<KeyboardContextValue | null>(null);

export function useKeyboardContext() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error("useKeyboardContext must be used within KeyboardProvider");
  }
  return context;
}
