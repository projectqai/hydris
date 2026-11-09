import type { Decorator } from "@storybook/react-native-web-vite";

import { ScreenLockContext } from "../screen-lock";

export const screenLocked: Decorator = (Story) => (
  <ScreenLockContext.Provider value>
    <Story />
  </ScreenLockContext.Provider>
);
