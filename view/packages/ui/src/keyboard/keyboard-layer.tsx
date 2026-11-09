import { type ReactNode, useEffect, useId, useMemo } from "react";

import { KeyboardContext, type ShortcutRegistration, useKeyboardContext } from "./keyboard-context";

export function KeyboardLayer({ children }: { children: ReactNode }) {
  const id = useId();
  const parent = useKeyboardContext();

  useEffect(() => parent.addLayer(id), [parent, id]);

  const value = useMemo(
    () => ({
      register: (shortcut: ShortcutRegistration) => parent.register({ ...shortcut, layer: id }),
      addLayer: parent.addLayer,
      layer: id,
    }),
    [parent, id],
  );

  if (parent.layer) {
    throw new Error("KeyboardLayer cannot be nested");
  }

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}
