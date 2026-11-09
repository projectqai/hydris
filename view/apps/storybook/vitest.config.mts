import path from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function storybookProject(scheme: "dark" | "light") {
  return {
    extends: true,
    plugins: [
      storybookTest({ configDir: path.join(dirname, ".storybook"), initialGlobals: { scheme } }),
    ],
    test: {
      name: `storybook-${scheme}`,
      setupFiles: ["./vitest.setup.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { chromiumSandbox: true } }),
        instances: [{ browser: "chromium" as const }],
      },
    },
  };
}

// Storybook's test run allows one project per config folder
const schemes: ("dark" | "light")[] = process.env.TEST_INCLUDE_LIGHT_SCHEME
  ? ["dark", "light"]
  : ["dark"];

export default defineConfig({
  test: { projects: schemes.map(storybookProject) },
});
