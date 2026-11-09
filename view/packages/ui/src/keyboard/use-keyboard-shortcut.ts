import { useEffect, useId } from "react";

import { type ShortcutHandler, useKeyboardContext } from "./keyboard-context";

type UseKeyboardShortcutOptions = {
  priority?: number;
  yieldToFocus?: boolean;
};

export function useKeyboardShortcut(
  key: string,
  handler: ShortcutHandler,
  options?: UseKeyboardShortcutOptions,
) {
  const id = useId();
  const { register } = useKeyboardContext();
  const priority = options?.priority ?? 0;
  const yieldToFocus = options?.yieldToFocus ?? false;

  useEffect(() => {
    return register({
      id,
      key,
      handler,
      priority,
      yieldToFocus,
    });
  }, [id, key, handler, priority, yieldToFocus, register]);
}
