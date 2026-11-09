import "../../foss/global.css";

import type { Preview } from "@storybook/react-native-web-vite";
import { restoreAllMocks, sb } from "storybook/test";
import { themes } from "storybook/theming";

import { startClock } from "../../../packages/core/src/storybook/clock";
import { resetStores } from "../../../packages/core/src/storybook/seed";
import { ThemeFrame } from "../theme-decorator";

// keep in sync with the Metro config mocks
sb.mock(import("../../../packages/core/src/lib/api/world-client.ts"));
sb.mock(import("../../../packages/core/src/lib/api/use-chat.ts"));
sb.mock(import("../../../packages/core/src/lib/download.ts"));
sb.mock(import("../../../packages/core/src/lib/location-search.ts"));
sb.mock(import("../../../packages/core/src/features/sensors/use-alarm-audio.ts"));
sb.mock(
  import("../../../packages/core/src/features/aware/components/video-stream/use-whep-connection.ts"),
);
sb.mock(import("../../../packages/ui/src/hooks/hold-to-confirm-flag.ts"));
sb.mock(import("expo-clipboard"));

const preview: Preview = {
  tags: ["autodocs"],
  globalTypes: {
    scheme: {
      description: "Colour scheme",
      toolbar: {
        title: "Scheme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: "dark" },
  beforeEach: [
    resetStores,
    startClock,
    // restore on cleanup, as restoreMocks runs on every re-render
    () => restoreAllMocks,
    // late font swaps move text that play tests measure
    async () => {
      await Promise.all([...document.fonts].map((font) => font.load()));
    },
  ],
  decorators: [
    (Story, { globals }) => (
      <ThemeFrame scheme={globals.scheme}>
        <Story />
      </ThemeFrame>
    ),
  ],
  parameters: {
    controls: { disableSaveFromUI: true },
    docs: { theme: themes.dark },
    a11y: { test: "error" },
    test: { restoreMocks: false },
  },
};

export default preview;
