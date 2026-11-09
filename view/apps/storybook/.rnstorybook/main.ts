import type { StorybookConfig } from "@storybook/react-native";

const main: StorybookConfig = {
  stories: [
    "../../../packages/ui/src/**/*.stories.tsx",
    "../../../packages/core/src/**/*.stories.tsx",
  ],
};

export default main;
