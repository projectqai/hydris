import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { KeyboardContext, type ShortcutRegistration } from "./keyboard-context";

type KeyboardProviderProps = {
  children: ReactNode;
};

type WebKeyboardEvent = {
  key: string;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const CONTROL_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
]);

const CONTROL_KEYS = new Set(["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const SLIDER_KEYS = new Set([...CONTROL_KEYS, "Home", "End", "PageUp", "PageDown"]);

function focusedControlKeeps(target: EventTarget | null, key: string): boolean {
  if (key === "Escape" || key === "Tab" || !(target instanceof HTMLElement)) return false;

  if (
    (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
    return true;

  const role =
    target.getAttribute("role") ?? (target instanceof HTMLButtonElement ? "button" : null);

  // rows driven by a list highlight sit outside the tab order and leave their keys to the list.
  // a radio in a roving group is outside it too, but it holds real focus and keeps its keys.
  if (role === null || (target.tabIndex < 0 && role !== "radio")) return false;

  if (role === "slider") return SLIDER_KEYS.has(key);

  return CONTROL_ROLES.has(role) && CONTROL_KEYS.has(key);
}

declare const window:
  | {
      addEventListener: (
        event: string,
        handler: (e: WebKeyboardEvent) => void,
        capture?: boolean,
      ) => void;
      removeEventListener: (
        event: string,
        handler: (e: WebKeyboardEvent) => void,
        capture?: boolean,
      ) => void;
    }
  | undefined;

export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const registryRef = useRef<Map<string, ShortcutRegistration>>(new Map());
  const layersRef = useRef<string[]>([]);

  const value = useMemo(
    () => ({
      register: (shortcut: ShortcutRegistration) => {
        registryRef.current.set(shortcut.id, shortcut);

        return () => {
          registryRef.current.delete(shortcut.id);
        };
      },
      addLayer: (layer: string) => {
        layersRef.current.push(layer);

        return () => {
          layersRef.current = layersRef.current.filter((l) => l !== layer);
        };
      },
    }),
    [],
  );

  useEffect(() => {
    if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return;

    const handleKeyDown = (e: WebKeyboardEvent) => {
      const topLayer = layersRef.current.at(-1);
      const kept = focusedControlKeeps(e.target, e.key);
      const handlers = Array.from(registryRef.current.values())
        .filter(
          (s) => s.key === e.key && (!s.layer || s.layer === topLayer) && !(kept && s.yieldToFocus),
        )
        .sort((a, b) => b.priority - a.priority);

      for (const shortcut of handlers) {
        const result = shortcut.handler();
        if (result === true) {
          e.preventDefault();
          e.stopPropagation();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}
