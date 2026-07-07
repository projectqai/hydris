import { createContext, useContext } from "react";

// the lock overlay blocks plain touches via the JS responder, but RNGH gestures run
// outside that system and still fire on native. each content gesture disables itself.
export const ScreenLockContext = createContext(false);

export function useIsScreenLocked() {
  return useContext(ScreenLockContext);
}
