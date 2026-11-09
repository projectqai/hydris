import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-native-web-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: [
    "../../../packages/ui/src/**/*.stories.tsx",
    "../../../packages/core/src/**/*.stories.tsx",
  ],
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-vitest",
    "storybook-addon-pseudo-states",
  ],
  framework: {
    name: "@storybook/react-native-web-vite",
    options: {
      pluginReactOptions: {
        jsxImportSource: "nativewind",
        // Reanimated's useAnimatedStyle throws on web without the worklets transform
        babel: { plugins: ["react-native-worklets/plugin"] },
      },
    },
  },
  staticDirs: ["../public", { from: "../../foss/public/fonts", to: "/fonts" }],
  core: { disableTelemetry: true },
  features: { sidebarOnboardingChecklist: false },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      // lucide-react-native 1.21 and expo-modules-core re-export missing names
      optimizeDeps: { rolldownOptions: { shimMissingExports: true } },
      resolve: {
        // Bun's isolated install hides or duplicates these across packages
        dedupe: ["react-native-web", "expo-linear-gradient", "expo-clipboard"],
        // sb.mock fails for expo-router. Keep in sync with the Metro config
        alias: [
          {
            find: /^expo-router$/,
            replacement: fileURLToPath(new URL("../__mocks__/expo-router.ts", import.meta.url)),
          },
        ],
      },
    }),
};

export default config;
